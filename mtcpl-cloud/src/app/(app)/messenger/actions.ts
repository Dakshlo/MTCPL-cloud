"use server";

// ──────────────────────────────────────────────────────────────────
// Messenger server actions (Mig 078)
// ──────────────────────────────────────────────────────────────────
// All writes for the owner ↔ developer chat pilot live here. Reads
// (the initial thread + peer + unread) also land here so the client
// component never needs to query the DB directly — it only needs
// the realtime subscription to know "something changed, refetch".
//
// Auth posture:
//   • Every entrypoint calls requireAuth() then canUseMessenger().
//     If the caller doesn't qualify we return an error rather than
//     redirecting — the messenger is a popover; a 302 mid-action
//     would silently fail in the panel UI. The caller renders the
//     error in a toast.
//   • All DB work goes through createAdminSupabaseClient() because
//     the only RLS in play is the blanket SELECT-to-authenticated
//     read policy from mig 029 (good for realtime). Writes via
//     service role match every other action in this app.
//
// Storage:
//   • messenger_media bucket (private). Voice notes (webm/opus,
//     ≤2 MB) and images (jpeg/png, ≤1 MB). Files are uploaded under
//     a randomly-named path; we never trust client-supplied names.
//   • Reads via `createSignedUrl(path, 300)` — 5-min freshness is
//     plenty for the panel's lifetime; if the user holds the panel
//     open longer the next router.refresh re-mints fresh URLs.
// ──────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseMessenger, peerRoleFor } from "@/lib/messenger-permissions";

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
  // MediaRecorder on Safari ≥ 14.5 emits audio/mp4. Listed so iOS
  // users on the dev's side aren't shut out of voice notes.
]);

const IMAGE_MIME_ALLOW = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  // webp slipped in because pasted screenshots on macOS Sonoma come
  // out as webp now. Same ≤1 MB ceiling applies.
]);

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

export type MessengerPeer = {
  id: string;
  full_name: string | null;
  role: "owner" | "developer";
};

export type MessengerInitialState =
  | {
      ok: true;
      self: { id: string; role: "owner" | "developer"; full_name: string | null };
      peer: MessengerPeer | null; // null = peer profile not provisioned yet
      messages: MessengerMessage[];
      unreadCount: number;
    }
  | { ok: false; reason: "not_permitted" | "internal_error" };

// ── Helpers ───────────────────────────────────────────────────────

/** Filter for "thread between A and B": either direction of the pair. */
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

// ── Read APIs ─────────────────────────────────────────────────────

/** Load the peer + the whole thread + the unread count in a single
 *  trip. Called when the panel mounts. The client subscribes to
 *  postgres_changes and reruns this whenever a row changes. */
export async function loadMessengerThread(): Promise<MessengerInitialState> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, reason: "not_permitted" };
  }

  const admin = createAdminSupabaseClient();
  const otherRole = peerRoleFor(profile.role);

  // Find the (single) peer profile for the pilot. is_active = true
  // so a soft-deactivated owner/dev row doesn't get picked up.
  const { data: peerRow, error: peerErr } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("role", otherRole)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (peerErr) {
    return { ok: false, reason: "internal_error" };
  }

  const peer: MessengerPeer | null = peerRow
    ? {
        id: peerRow.id as string,
        full_name: (peerRow.full_name as string | null) ?? null,
        role: peerRow.role as "owner" | "developer",
      }
    : null;

  // With no peer there's nothing to fetch — return an empty thread.
  if (!peer) {
    return {
      ok: true,
      self: {
        id: profile.id,
        role: profile.role as "owner" | "developer",
        full_name: profile.full_name,
      },
      peer: null,
      messages: [],
      unreadCount: 0,
    };
  }

  // Pull the entire thread in chronological order. The pilot pair
  // is tiny (Daksh's estimate: hundreds of rows over weeks); no
  // pagination needed yet. Once we widen the helper we'll add a
  // cursor here. Explicit limit() so we never OOM on a bug.
  const { data: msgs, error: msgsErr } = await admin
    .from("messenger_messages")
    .select(
      "id, sender_id, recipient_id, kind, body, media_path, media_mime, media_duration_sec, read_at, deleted_at, deleted_by, created_at",
    )
    .or(pairOr(profile.id, peer.id))
    .order("created_at", { ascending: true })
    .limit(500);

  if (msgsErr) {
    return { ok: false, reason: "internal_error" };
  }

  const messages = (msgs ?? []) as MessengerMessage[];
  const unreadCount = messages.filter(
    (m) => m.recipient_id === profile.id && !m.read_at && !m.deleted_at,
  ).length;

  return {
    ok: true,
    self: {
      id: profile.id,
      role: profile.role as "owner" | "developer",
      full_name: profile.full_name,
    },
    peer,
    messages,
    unreadCount,
  };
}

/** Cheap stand-alone unread count for the pill badge — fetched
 *  separately from loadMessengerThread so the badge can update
 *  without touching the whole thread. Returns 0 when the role
 *  doesn't qualify (badge stays hidden via the role gate on the
 *  pill render itself). */
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

/** Sign a media path for short-lived rendering. 5-min freshness is
 *  fine for the panel — even if the user lingers on a bubble, the
 *  next realtime tick re-mints URLs. Returns null on any failure
 *  (the bubble will fall back to a "media unavailable" stub). */
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

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/** Resolve the (single) pilot peer for the caller. Centralised so
 *  every send/delete action uses the same lookup. */
async function resolvePeerId(
  callerRole: "owner" | "developer",
): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const otherRole = peerRoleFor(callerRole);
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("role", otherRole)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Send a plain text message to the pilot peer. Body must be
 *  non-empty after trim and ≤ 2000 chars. */
export async function sendTextMessage(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const rawBody = formData.get("body");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (!body) return { ok: false, error: "Message is empty" };
  if (body.length > MAX_TEXT_LEN) {
    return { ok: false, error: `Message too long (max ${MAX_TEXT_LEN})` };
  }

  const peerId = await resolvePeerId(profile.role as "owner" | "developer");
  if (!peerId) {
    return { ok: false, error: "No peer found — the other side isn't set up yet" };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("messenger_messages")
    .insert({
      sender_id: profile.id,
      recipient_id: peerId,
      kind: "text",
      body,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

/** Send a voice note or an image. Validates mime + size, uploads
 *  to storage under a random path, then inserts the row. Failure
 *  modes:
 *    • missing/unrecognised mime → "Unsupported file type"
 *    • oversized → "Voice too large (max 2 MB)" / image variant
 *    • storage 4xx → surfaced to the user verbatim
 *  Duration is voice-only and is trusted from the client (it's
 *  cosmetic — the actual audio is the source of truth). Capped at
 *  600 s server-side via the CHECK constraint anyway. */
export async function sendMediaMessage(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

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

  const peerId = await resolvePeerId(profile.role as "owner" | "developer");
  if (!peerId) {
    return { ok: false, error: "No peer found — the other side isn't set up yet" };
  }

  const admin = createAdminSupabaseClient();
  const ext = extensionFor(mime, kind);
  const path = `${profile.id}/${randomUUID()}.${ext}`;

  // Stream the file body up to Supabase Storage. The SDK takes
  // ArrayBuffer / Blob / Buffer — File works because it extends
  // Blob, but we go through arrayBuffer() so the underlying fetch
  // gets a known content length (avoids chunked-upload weirdness
  // on some Supabase edge regions).
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
      recipient_id: peerId,
      kind,
      media_path: path,
      media_mime: mime,
      media_duration_sec: durationSec,
    })
    .select("id")
    .single();
  if (error) {
    // Best-effort cleanup so we don't leave orphan blobs around.
    // Ignore the delete result — if it fails we still surface the
    // insert error, which is what the user actually saw.
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id as string | undefined };
}

/** Soft-delete a message. Only the original sender may delete their
 *  own message; recipient + bystanders get a silent no-op. The row
 *  stays auditable (deleted_at + deleted_by stamped); body is
 *  cleared, media_path is blanked, the storage object is left in
 *  place (cheap; not worth a deletion job for the pilot).
 *
 *  Recipient UI flips the bubble to "🚫 This message was deleted". */
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
  // Match on sender_id so we don't accidentally allow the
  // recipient to nuke the other side's message. deleted_at IS NULL
  // means a re-delete is a no-op (avoids stomping the original
  // deleted_at timestamp on an idempotent retry).
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

/** Stamp read_at on every unread message addressed to the caller in
 *  this thread. Called when the panel opens AND every time a new
 *  inbound message arrives while the panel is open. Idempotent —
 *  filters on read_at IS NULL so a second call is a no-op. */
export async function markThreadReadAction(): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseMessenger(profile)) {
    return { ok: false, error: "Not permitted" };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("messenger_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .is("read_at", null)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
