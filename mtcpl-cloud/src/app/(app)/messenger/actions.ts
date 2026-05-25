"use server";

// ──────────────────────────────────────────────────────────────────
// Messenger server actions (Mig 078)
// ──────────────────────────────────────────────────────────────────
// All reads + writes for the messenger pilot live here. Reads also
// land here (rather than letting the client query DB directly) so
// permission gating + recipient validation happen in one place.
//
// Round-2 follow-on: the pilot widened from a strict owner ↔
// developer pair to "any owner or developer can chat with any other
// owner or developer." That changed the loader shape — we now have:
//
//   • loadMessengerContacts() — returns the user's roster
//     (everyone-they-can-chat-with), each row carrying the unread
//     count + the latest message snippet. Powers the contacts list.
//   • loadMessengerThread(peerId) — returns one specific
//     conversation. Powers the thread view.
//
// All sends + the read-marker now take an explicit recipient_id
// (sender) or peer_id (receiver) from FormData. The server
// validates that the target is a permitted messenger user via
// isPermittedMessengerRole — a tampered client can't aim a message
// at a slab-entry profile.
//
// Auth posture (unchanged):
//   • requireAuth() then canUseMessenger() on every entrypoint.
//     Failures return { ok: false, ... } rather than redirecting
//     (the messenger is a popover; 302 mid-action silently fails
//     in the panel).
//   • All DB work via createAdminSupabaseClient(). Only RLS in
//     play is the mig 029 authenticated_read_all SELECT policy.
//
// Storage (unchanged):
//   • messenger_media bucket (private). Voice notes (webm/opus,
//     ≤2 MB), images (jpeg/png/webp, ≤1 MB). Reads via
//     `createSignedUrl(path, 300)`.
// ──────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canUseMessenger,
  isPermittedMessengerRole,
} from "@/lib/messenger-permissions";

// ── Constants ─────────────────────────────────────────────────────

const BUCKET = "messenger_media";
const MAX_TEXT_LEN = 2000;
const VOICE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const IMAGE_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

const VOICE_MIME_ALLOW = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]);
const IMAGE_MIME_ALLOW = new Set(["image/jpeg", "image/png", "image/webp"]);

// All columns we want back on a message row. Centralised so the
// contacts loader + the thread loader return identical shapes.
const MESSAGE_COLS =
  "id, sender_id, recipient_id, kind, body, media_path, media_mime, media_duration_sec, read_at, deleted_at, deleted_by, created_at";

// ── Types ─────────────────────────────────────────────────────────

export type MessengerKind = "text" | "voice" | "image";

export type MessengerMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  kind: MessengerKind;
  body: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_duration_sec: number | null;
  read_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
};

export type MessengerRole = "owner" | "developer";

export type MessengerSelf = {
  id: string;
  role: MessengerRole;
  full_name: string | null;
};

export type MessengerContact = {
  id: string;
  full_name: string | null;
  role: MessengerRole;
  /** Unread messages addressed to caller from this peer. */
  unread_count: number;
  /** ISO of the latest message in either direction; null if no history. */
  last_message_at: string | null;
  /** Human-readable preview ("Hi", "🎙 Voice note", "🚫 Deleted message"). */
  last_message_snippet: string | null;
  /** True if the latest message was sent BY caller. Used to prefix "You:". */
  last_message_from_self: boolean;
};

export type MessengerContactsState =
  | { ok: true; self: MessengerSelf; contacts: MessengerContact[] }
  | { ok: false; reason: "not_permitted" | "internal_error" };

export type MessengerThreadState =
  | {
      ok: true;
      self: MessengerSelf;
      peer: MessengerContact;
      messages: MessengerMessage[];
    }
  | { ok: false; reason: "not_permitted" | "peer_not_found" | "internal_error" };

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// ── Helpers ───────────────────────────────────────────────────────

/** PostgREST OR filter for "either direction of this pair." */
function pairOr(selfId: string, peerId: string) {
  return (
    `and(sender_id.eq.${selfId},recipient_id.eq.${peerId}),` +
    `and(sender_id.eq.${peerId},recipient_id.eq.${selfId})`
  );
}

function extensionFor(mime: string, kind: "voice" | "image"): string {
  if (kind === "voice") {
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  }
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** One-line snippet for the contacts list. Mirrors WhatsApp's preview. */
function snippetFor(
  msg: Pick<MessengerMessage, "kind" | "body" | "deleted_at">,
): string {
  if (msg.deleted_at) return "🚫 Deleted message";
  if (msg.kind === "voice") return "🎙 Voice note";
  if (msg.kind === "image") return "🖼 Image";
  return (msg.body || "").trim();
}

/** Light row used during contacts aggregation (no full media columns
 *  needed for snippet generation). */
type ContactScanRow = {
  sender_id: string;
  recipient_id: string;
  kind: MessengerKind;
  body: string | null;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

// ── Read APIs ─────────────────────────────────────────────────────

/** Load the user's contact roster — every permitted messenger user
 *  except the caller, with unread count + latest-message snippet
 *  attached. Sorted: contacts with activity first (most recent on
 *  top), then those without (alphabetical by name).
 *
 *  Two queries:
 *    1. profiles where role IN (...) AND is_active AND id <> self
 *    2. last 2000 messages involving self, grouped in-memory by peer.
 *
 *  2000 is generous for the pilot scale and lets us avoid a per-
 *  contact roundtrip. Once we widen further or thread volume grows
 *  this could become a single SQL with DISTINCT ON. */
export async function loadMessengerContacts(): Promise<MessengerContactsState> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) return { ok: false, reason: "not_permitted" };

  const admin = createAdminSupabaseClient();

  const { data: peers, error: peersErr } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["owner", "developer"])
    .eq("is_active", true)
    .neq("id", profile.id);
  if (peersErr) return { ok: false, reason: "internal_error" };

  const { data: msgs, error: msgsErr } = await admin
    .from("messenger_messages")
    .select(
      "sender_id, recipient_id, kind, body, read_at, deleted_at, created_at",
    )
    .or(`sender_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (msgsErr) return { ok: false, reason: "internal_error" };

  const rows = (msgs ?? []) as ContactScanRow[];

  const contacts: MessengerContact[] = (peers ?? []).map((p) => {
    const peerId = p.id as string;
    let lastMsg: ContactScanRow | null = null;
    let unread = 0;
    for (const m of rows) {
      const otherId = m.sender_id === profile.id ? m.recipient_id : m.sender_id;
      if (otherId !== peerId) continue;
      if (!lastMsg) lastMsg = m; // rows come sorted DESC, so first hit wins
      if (
        m.recipient_id === profile.id &&
        !m.read_at &&
        !m.deleted_at
      ) {
        unread++;
      }
    }
    return {
      id: peerId,
      full_name: (p.full_name as string | null) ?? null,
      role: p.role as MessengerRole,
      unread_count: unread,
      last_message_at: lastMsg?.created_at ?? null,
      last_message_snippet: lastMsg ? snippetFor(lastMsg) : null,
      last_message_from_self: lastMsg ? lastMsg.sender_id === profile.id : false,
    };
  });

  contacts.sort((a, b) => {
    // Active contacts (any history) before never-messaged ones.
    if (a.last_message_at && b.last_message_at) {
      return b.last_message_at.localeCompare(a.last_message_at);
    }
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });

  return {
    ok: true,
    self: {
      id: profile.id,
      role: profile.role as MessengerRole,
      full_name: profile.full_name,
    },
    contacts,
  };
}

/** Load the full conversation with one specific peer. The peer is
 *  re-validated server-side (isPermittedMessengerRole + is_active)
 *  so a tampered peerId can't be used to fetch unrelated rows. */
export async function loadMessengerThread(
  peerId: string,
): Promise<MessengerThreadState> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) return { ok: false, reason: "not_permitted" };
  if (!peerId || typeof peerId !== "string") {
    return { ok: false, reason: "peer_not_found" };
  }
  if (peerId === profile.id) return { ok: false, reason: "peer_not_found" };

  const admin = createAdminSupabaseClient();

  const { data: peerRow, error: peerErr } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", peerId)
    .maybeSingle();
  if (peerErr) return { ok: false, reason: "internal_error" };
  if (
    !peerRow ||
    !peerRow.is_active ||
    !isPermittedMessengerRole(peerRow.role as string)
  ) {
    return { ok: false, reason: "peer_not_found" };
  }

  const { data: msgs, error: msgsErr } = await admin
    .from("messenger_messages")
    .select(MESSAGE_COLS)
    .or(pairOr(profile.id, peerId))
    .order("created_at", { ascending: true })
    .limit(500);
  if (msgsErr) return { ok: false, reason: "internal_error" };

  const messages = (msgs ?? []) as MessengerMessage[];
  const unread = messages.filter(
    (m) => m.recipient_id === profile.id && !m.read_at && !m.deleted_at,
  ).length;
  const last = messages[messages.length - 1];

  return {
    ok: true,
    self: {
      id: profile.id,
      role: profile.role as MessengerRole,
      full_name: profile.full_name,
    },
    peer: {
      id: peerRow.id as string,
      full_name: (peerRow.full_name as string | null) ?? null,
      role: peerRow.role as MessengerRole,
      unread_count: unread,
      last_message_at: last?.created_at ?? null,
      last_message_snippet: last ? snippetFor(last) : null,
      last_message_from_self: last ? last.sender_id === profile.id : false,
    },
    messages,
  };
}

/** Total unread across every thread. Used by the pill badge before
 *  the panel is opened. */
export async function getMessengerUnreadCount(): Promise<number> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) return 0;

  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("messenger_messages")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", profile.id)
    .is("read_at", null)
    .is("deleted_at", null);

  return count ?? 0;
}

/** Short-lived signed URL for a media path. */
export async function getSignedMediaUrl(
  path: string,
): Promise<string | null> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) return null;
  if (!path || typeof path !== "string") return null;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── Write APIs ────────────────────────────────────────────────────

/** Validate a recipient_id supplied by the client. Returns
 *  { ok: true } if the target exists, is active, and has a
 *  permitted role; otherwise an action-friendly error. */
async function validateRecipient(
  selfId: string,
  recipientId: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (typeof recipientId !== "string" || !recipientId) {
    return { ok: false, error: "Missing recipient" };
  }
  if (recipientId === selfId) {
    return { ok: false, error: "Cannot message yourself" };
  }
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", recipientId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Recipient not found" };
  if (!data.is_active) return { ok: false, error: "Recipient is inactive" };
  if (!isPermittedMessengerRole(data.role as string)) {
    return { ok: false, error: "Recipient cannot receive messages" };
  }
  return { ok: true, id: data.id as string };
}

export async function sendTextMessage(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const recipient = await validateRecipient(
    profile.id,
    formData.get("recipient_id"),
  );
  if (!recipient.ok) return recipient;

  const rawBody = formData.get("body");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (!body) return { ok: false, error: "Message is empty" };
  if (body.length > MAX_TEXT_LEN) {
    return { ok: false, error: `Message too long (max ${MAX_TEXT_LEN})` };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("messenger_messages")
    .insert({
      sender_id: profile.id,
      recipient_id: recipient.id,
      kind: "text",
      body,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

export async function sendMediaMessage(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const recipient = await validateRecipient(
    profile.id,
    formData.get("recipient_id"),
  );
  if (!recipient.ok) return recipient;

  const rawKind = formData.get("kind");
  const kind = rawKind === "voice" || rawKind === "image" ? rawKind : null;
  if (!kind) return { ok: false, error: "Unknown media kind" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file attached" };
  }

  const mime = (file.type || "").toLowerCase();
  if (kind === "voice" && !VOICE_MIME_ALLOW.has(mime)) {
    return { ok: false, error: "Unsupported voice format" };
  }
  if (kind === "image" && !IMAGE_MIME_ALLOW.has(mime)) {
    return { ok: false, error: "Unsupported image format" };
  }

  const maxBytes = kind === "voice" ? VOICE_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > maxBytes) {
    return {
      ok: false,
      error:
        kind === "voice"
          ? "Voice too large (max 2 MB)"
          : "Image too large (max 1 MB)",
    };
  }

  let durationSec: number | null = null;
  if (kind === "voice") {
    const rawDur = formData.get("duration_sec");
    const parsed = typeof rawDur === "string" ? Number(rawDur) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 600) {
      durationSec = Math.round(parsed);
    }
  }

  const admin = createAdminSupabaseClient();
  const ext = extensionFor(mime, kind);
  const path = `${profile.id}/${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mime,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  const { data, error } = await admin
    .from("messenger_messages")
    .insert({
      sender_id: profile.id,
      recipient_id: recipient.id,
      kind,
      media_path: path,
      media_mime: mime,
      media_duration_sec: durationSec,
    })
    .select("id")
    .single();
  if (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id as string | undefined };
}

/** Soft-delete a message. Only the original sender may delete. */
export async function softDeleteMessage(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { ok: false, error: "Missing message id" };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("messenger_messages")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: profile.id,
      body: null,
      media_path: null,
    })
    .eq("id", id)
    .eq("sender_id", profile.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Cannot delete this message" };
  return { ok: true };
}

/** Stamp read_at on every unread message addressed to caller from a
 *  specific peer. Scoped to one thread so opening conversation A
 *  doesn't accidentally mark conversation B's badges as read. */
export async function markThreadReadAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const peerId = formData.get("peer_id");
  if (typeof peerId !== "string" || !peerId) {
    return { ok: false, error: "Missing peer" };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("messenger_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .eq("sender_id", peerId)
    .is("read_at", null)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
