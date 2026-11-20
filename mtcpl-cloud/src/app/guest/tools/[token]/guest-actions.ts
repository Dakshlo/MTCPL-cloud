"use server";

/**
 * Everything the wardrobe QR can do: sign in with a code, and record a
 * take. That is the whole surface.
 *
 * Nothing the phone sends is trusted. The sticker is re-read from the
 * database on every call, the session is re-read on every take, and the
 * person's phone number is never taken from the request — only from
 * their own profile row.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canKeepAtCupboard,
  canSignInAtCupboard,
} from "@/lib/cnc-tool-permissions";
import { issueActionOtp, verifyActionOtp } from "@/lib/action-otp";
import {
  GUEST_MAX_QTY,
  resolveToolStoreLink,
  takesThroughLinkToday,
  usesThroughLinkToday,
} from "@/lib/cnc-tool-guest";
import {
  TOOL_IMAGE_BUCKET,
  UNDO_WINDOW_MS,
  moveRefusal,
  type MoveOutcome,
} from "@/lib/cnc-tool-stock";
import { takeReceiptQr, takeReceiptUrl } from "@/lib/cnc-tool-receipt";
import {
  MAX_USE_QTY,
  canUndoUsage,
  holdingsForPerson,
  settleRefusal,
  usageLinesSince,
  type HeldItem,
  type SettleOutcome,
} from "@/lib/cnc-tool-usage";
import {
  SESSION_HOURS,
  TOOL_OTP_DIGITS,
  currentToolSession,
  sessionCookieName,
  startToolSession,
} from "@/lib/cnc-tool-session";

/** The action name the code is bound to, so a tool-store code can never
 *  be replayed against the bill-archive prompt or vice versa. */
const OTP_ACTION = "cnc_tool_signin";

/**
 * Who does this id belong to, and may they sign in?
 *
 * The roster is HTML and HTML can be edited, so the rule that drew the
 * list is applied again here against the database. The phone comes back
 * with it, and only from the row — there is no way to ask for a code to
 * be sent somewhere new.
 */
type Signer = {
  /** Only ever "profile" now. The field stays because the session row
   *  and every downstream reader is still written in terms of the two
   *  kinds — mig 234's operator sessions in the database remain valid
   *  until they expire, and the history they signed is permanent. */
  kind: "profile";
  subjectId: string;
  /** action_otps.requested_by is NOT NULL and points at profiles. */
  requestedBy: string;
  profileId: string | null;
  operatorId: string | null;
  name: string;
  phone: string;
  vendorId: string | null;
  vendorName: string | null;
  /** May he fill the shelf — add a tool, add stock, fix a count? */
  canKeep: boolean;
};

async function resolveSigner(
  kind: string,
  id: string,
): Promise<{ ok: true; signer: Signer } | { ok: false; error: string }> {
  const gone = { ok: false as const, error: "That name is not on the list any more." };
  if (!id) return { ok: false, error: "Tap your name first." };

  const admin = createAdminSupabaseClient();

  // The operator branch lived here, Nov 2026. A man enrolled off a
  // sticker had his own tile and his own code; now his vendor's name is
  // the door he comes through. `kind` is still accepted and ignored so
  // a phone with the old screen cached cannot 500 on the next tap.
  void kind;

  const { data } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, vendor_id, can_keep_tool_store, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  const p = data as
    | {
        id: string; full_name: string | null; phone: string | null; role: string;
        is_active: boolean; vendor_id: string | null; can_keep_tool_store: boolean | null;
        vendors: { name: string } | { name: string }[] | null;
      }
    | null;
  // The same rule the roster was drawn with, applied again against the
  // database — the list is HTML and HTML can be edited.
  if (!p || !p.is_active || !canSignInAtCupboard(p as Parameters<typeof canSignInAtCupboard>[0])) {
    return gone;
  }

  const pv = Array.isArray(p.vendors) ? p.vendors[0] ?? null : p.vendors;

  return {
    ok: true,
    signer: {
      kind: "profile",
      subjectId: p.id,
      requestedBy: p.id,
      profileId: p.id,
      operatorId: null,
      name: (p.full_name || "Unnamed").trim(),
      phone: p.phone ?? "",
      // NO COMPANY for the office. Daksh, Nikhil and Vinay have no
      // vendor_id, so a tool they take is filed under Office and not
      // under somebody's firm — "when owners do changes it should go
      // under office". It falls out of the data rather than being a
      // special case, which is why it is written down here.
      vendorId: p.vendor_id,
      vendorName: pv?.name ?? null,
      canKeep: canKeepAtCupboard(p as Parameters<typeof canKeepAtCupboard>[0], {
        hasOwnCompany: !!p.vendor_id,
      }),
    },
  };
}

export type SendCodeResult =
  | { ok: true; sentTo: string }
  | { ok: false; error: string };

/**
 * Step 1 — somebody tapped their name.
 *
 * The code goes to the number on THAT profile. The request carries a
 * profile id and nothing else; there is no way to ask for a code to be
 * sent somewhere new.
 */
export async function sendToolSignInCodeAction(fd: FormData): Promise<SendCodeResult> {
  const token = String(fd.get("token") || "").trim();
  const kind = String(fd.get("person_kind") || "profile").trim();
  const personId = String(fd.get("person_id") || fd.get("profile_id") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not working. Ask the office." };
  }

  const who = await resolveSigner(kind, personId);
  if (!who.ok) return who;

  return issueActionOtp({
    action: OTP_ACTION,
    subjectId: who.signer.subjectId,
    requestedBy: who.signer.requestedBy,
    phone: who.signer.phone,
    digits: TOOL_OTP_DIGITS,
  });
}

export type VerifyCodeResult =
  | {
      ok: true;
      name: string;
      company: string | null;
      canKeep: boolean;
    }
  | { ok: false; error: string; attemptsLeft?: number };

/** Step 2 — the code they typed. On success this mints the take-only
 *  session and drops it in an HttpOnly cookie scoped to this route. */
export async function verifyToolSignInCodeAction(fd: FormData): Promise<VerifyCodeResult> {
  const token = String(fd.get("token") || "").trim();
  const kind = String(fd.get("person_kind") || "profile").trim();
  const personId = String(fd.get("person_id") || fd.get("profile_id") || "").trim();
  const code = String(fd.get("code") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) return { ok: false, error: "This QR is not working. Ask the office." };
  const link = resolved.link;

  const who = await resolveSigner(kind, personId);
  if (!who.ok) return { ok: false, error: who.error };
  const signer = who.signer;

  const check = await verifyActionOtp({
    action: OTP_ACTION,
    subjectId: signer.subjectId,
    code,
    digits: TOOL_OTP_DIGITS,
  });
  if (!check.ok) return { ok: false, error: check.error, attemptsLeft: check.attemptsLeft };

  const sessionToken = await startToolSession({
    profileId: signer.profileId,
    operatorId: signer.operatorId,
    linkId: link.id,
    vendorId: signer.vendorId,
  });
  if (!sessionToken) return { ok: false, error: "Could not start the session. Try again." };

  const jar = await cookies();
  jar.set(sessionCookieName(link.token), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/guest/tools/${link.token}`,
    maxAge: SESSION_HOURS * 3600,
  });

  // The session carries the person's company. Nobody is ASKED for it
  // (mig 232) — the code to their phone is the signature — but it is
  // what puts a take under MOHIT in the office register.
  //
  // canKeep comes back with it rather than being worked out on the
  // screen from the tile that was tapped. The screen guessing it is
  // what got the developer wrong once already.
  return {
    ok: true,
    name: signer.name,
    company: signer.vendorName,
    canKeep: signer.canKeep,
  };
}

/** Sign out — one tap when you hand the phone back. */
export async function toolSignOutAction(fd: FormData): Promise<{ ok: boolean }> {
  const token = String(fd.get("token") || "").trim();
  const resolved = await resolveToolStoreLink(token);
  if (!("problem" in resolved)) {
    const session = await currentToolSession(token, resolved.link.id);
    if (session) {
      const admin = createAdminSupabaseClient();
      await admin
        .from("cnc_tool_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", session.id);
    }
    const jar = await cookies();
    jar.delete(sessionCookieName(resolved.link.token));
  }
  return { ok: true };
}

/**
 * The slip the card shows and the man keeps (Nov 2026).
 *
 * Built here, on the server, and handed down whole — the QR is already
 * drawn by the time the card paints, so a phone on a shed connection
 * does not have to fetch anything or run a QR library to show it.
 *
 * `id` is the movement id and nothing else: the QR points at the row,
 * so the slip is re-read on every scan and dies when the take is undone.
 * See lib/cnc-tool-receipt.ts for why there is no receipts table.
 */
export type TakeSlip = {
  id: string;
  url: string;
  /** The QR as inline SVG, ready to drop into the card. */
  svg: string;
  at: string;
  takenBy: string;
  company: string | null;
  toolName: string;
  toolSpec: string | null;
  unit: string;
  qty: number;
};

export type GuestTakeResult =
  | {
      ok: true; left: number; toolName: string; qty: number;
      /** Null only if the write somehow came back without an id — the
       *  take still happened, so the card falls back to the old line
       *  rather than pretending nothing was taken. */
      slip: TakeSlip | null;
    }
  | { ok: false; error: string; signedOut?: boolean };

/** What a taken-back take reports, so the card can put the pcs back in
 *  his account without a round trip. */
export type GuestUndoResult =
  | { ok: true; toolId: string; toolName: string; qty: number }
  | { ok: false; error: string; signedOut?: boolean };

/** The only write: this signed-in person took N of one tool. */
export async function guestTakeToolAction(formData: FormData): Promise<GuestTakeResult> {
  const token = String(formData.get("token") || "").trim();
  const toolId = String(formData.get("tool_id") || "").trim();
  const qty = Number(formData.get("qty"));

  // ── 1. The sticker ───────────────────────────────────────────────
  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return {
      ok: false,
      error:
        resolved.problem === "revoked"
          ? "This QR has been switched off. Ask the office for the new one."
          : "This QR is not valid. Ask the office for the new one.",
    };
  }
  const link = resolved.link;

  // ── 2. Who is signed in ──────────────────────────────────────────
  // Re-read every time: the name, the company and the right to be here
  // all come from the database, never from the page.
  const session = await currentToolSession(token, link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }
  // ── 3. What they asked for ───────────────────────────────────────
  if (!toolId) return { ok: false, error: "Pick a tool first." };
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
    return { ok: false, error: "How many? Enter at least 1." };
  }
  if (qty > GUEST_MAX_QTY) {
    return { ok: false, error: `That is a lot — ${GUEST_MAX_QTY} is the most in one go. Ask the office.` };
  }

  const admin = createAdminSupabaseClient();

  // ── 4. The day's ceiling on this sticker ─────────────────────────
  const usedToday = await takesThroughLinkToday(link.id);
  if (usedToday >= link.dailyCap) {
    return {
      ok: false,
      error: "This QR has recorded a lot today and is paused until tomorrow. Tell the office.",
    };
  }

  // ── 5. Check the shelf and write the line, as ONE step ───────────
  //
  // Mig 235. This used to read the stock, decide, and then insert —
  // three statements with daylight between them. Two men at the
  // cupboard at the same second both read "1 left", both passed the
  // check, and both took the last one. The check and the insert now
  // happen inside a lock on that tool, so the second man's read
  // already includes the first man's take and he is told the truth.
  //
  // taken_by keeps the readable name every existing screen shows;
  // taken_by_profile_id / _operator_id is the part that cannot be
  // typed, and vendor_id is what groups him under his company.
  const { data: raw, error } = await admin.rpc("cnc_tool_record_move", {
    p_tool_id: toolId,
    p_kind: "issue",
    p_delta: -Math.abs(qty),
    p_taken_by: session.name,
    p_taken_by_profile: session.profileId,
    p_taken_by_operator: session.operatorId,
    p_vendor_id: session.vendorId,
    p_guest_link: link.id,
  });
  if (error) return { ok: false, error: error.message };

  const res = (raw ?? {}) as MoveOutcome;

  // The unit is dropped here: on the cupboard screen the number sits
  // next to a big "PCS" already, and "only 3 pcs pcs left" is how that
  // reads if both say it.
  if (!res.ok) return { ok: false, error: moveRefusal(res, { unit: false }) };

  await admin
    .from("cnc_tool_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  revalidatePath("/tools");

  const toolName = res.tool ?? "tool";
  const movementId = res.movement_id ?? null;

  let slip: TakeSlip | null = null;
  if (movementId) {
    const url = takeReceiptUrl(movementId);
    slip = {
      id: movementId,
      url,
      svg: await takeReceiptQr(url),
      // The row's own created_at would mean another read. This is the
      // same second, and the SLIP ITSELF is read back from the row when
      // anybody scans it, so the authoritative time is never this one.
      at: new Date().toISOString(),
      takenBy: session.name,
      company: session.vendorName,
      toolName,
      toolSpec: null,
      unit: res.unit ?? "pcs",
      qty,
    };
  }

  return { ok: true, left: Number(res.stock_after ?? 0), toolName, qty, slip };
}

/**
 * Take back a take, inside the ten minutes.
 *
 * Daksh, Nov 2026: "on that card there will be an undo button."
 *
 * The office has had this since mig 227; the cupboard never did, which
 * meant the man who made the mistake had to find somebody at a desk to
 * fix it. Same soft void as everywhere else in this module: the line
 * stays in the register with a stroke through it, the shelf comes back
 * on its own because stock is SUM(delta) over live rows, and the slip's
 * QR starts answering "no longer valid" to anybody who scans it.
 *
 * Only his own. The id is checked against the session rather than
 * trusted, so an edited form cannot void somebody else's take.
 */
export async function guestUndoTakeAction(fd: FormData): Promise<GuestUndoResult> {
  const token = String(fd.get("token") || "").trim();
  const movementId = String(fd.get("movement_id") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not valid. Ask the office for the new one." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }
  if (!movementId) return { ok: false, error: "Nothing to take back." };

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_movements")
    .select("id, tool_id, kind, delta, created_at, undone_at, taken_by_profile_id, taken_by_operator_id, cnc_tools(name)")
    .eq("id", movementId)
    .maybeSingle();

  const row = data as
    | {
        id: string; tool_id: string; kind: string; delta: number | string;
        created_at: string; undone_at: string | null;
        taken_by_profile_id: string | null; taken_by_operator_id: string | null;
        cnc_tools: { name: string } | { name: string }[] | null;
      }
    | null;
  if (!row) return { ok: false, error: "Nothing to take back." };

  const isMine =
    (!!session.profileId && row.taken_by_profile_id === session.profileId) ||
    (!!session.operatorId && row.taken_by_operator_id === session.operatorId);
  if (!isMine) return { ok: false, error: "That one is not yours to take back." };
  if (row.kind !== "issue") return { ok: false, error: "That is not a take." };
  if (row.undone_at) return { ok: false, error: "That one is already taken back." };
  if (Date.now() - new Date(row.created_at).getTime() > UNDO_WINDOW_MS) {
    return { ok: false, error: "Too late to take that back. Tell the office." };
  }

  // The WHERE clause is the lock: two taps, one undo.
  const { data: done, error } = await admin
    .from("cnc_tool_movements")
    .update({
      undone_at: new Date().toISOString(),
      undone_by: session.profileId,
      undone_by_operator_id: session.operatorId,
    })
    .eq("id", movementId)
    .is("undone_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!done) return { ok: false, error: "That one is already taken back." };

  revalidatePath("/tools");

  const name =
    (Array.isArray(row.cnc_tools) ? row.cnc_tools[0] : row.cnc_tools)?.name ?? "tool";
  return {
    ok: true,
    toolId: row.tool_id,
    toolName: name,
    qty: Math.abs(Number(row.delta)),
  };
}

// ──────────────────────────────────────────────────────────────────
// A vendor's own men (mig 234) — REMOVED Nov 2026
// ──────────────────────────────────────────────────────────────────
//
// myTeamAction, enrolOperatorAction and removeOperatorAction lived
// here. A vendor holding a live OTP session could add one of his men by
// name and number; that man then got a tile of his own on the roster
// and a code to his own phone.
//
// Daksh took it back out: "that login module we made so vendors'
// operators can also login — remove that thing. If a vendor's operator
// wants access they will click on their respective vendor, eg Vivek,
// then his operator will click on Vivek and take the OTP from Vivek.
// No separate thing for them. So remove that create-new-operator list
// thing."
//
// Nothing is dropped from the database — see lib/cnc-tool-session.ts
// for the reasoning and for what stays behind.

// ──────────────────────────────────────────────────────────────────
// Keeping the shelf from the cupboard itself
// ──────────────────────────────────────────────────────────────────
// Daksh, Nov 2026: "add [an] add item button so i can directly
// maintain or add stock from phone only... to both owner too add this
// maintain and add stock thing."
//
// The office screen has always been able to do these three. The point
// of putting them here is that the shelf is HERE: a box of bits
// arrives, the man is standing at the open cupboard with his phone,
// and the alternative is remembering to type it in later — which is
// the paper register with extra steps.
//
// Nothing is loosened to allow it. The same OTP that signs a take
// signs these, and canKeep is re-read from the profile on every call,
// so it is the three office people and nobody else. Taking is still
// the only thing a vendor or his man can do through this door.
//
// guest_link_id is deliberately NOT set on these rows: that column
// means "taken at the cupboard QR", and mig 229 has a constraint
// saying so. Stock arriving is not a take.

export type KeeperResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** The signed-in person, if they may keep the store. */
async function keeperAt(token: string) {
  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false as const, error: "This QR is not working. Ask the office." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false as const, error: "Your sign-in has run out. Tap your name again." };
  }
  if (!session.canKeep || !session.profileId) {
    return { ok: false as const, error: "Only the office can change the shelf." };
  }
  return { ok: true as const, profileId: session.profileId, name: session.name };
}

const qtyOf = (fd: FormData, k: string): number => {
  const n = Number(String(fd.get(k) ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
};

/** A box of bits has arrived. */
export async function keeperAddStockAction(fd: FormData): Promise<KeeperResult> {
  const who = await keeperAt(String(fd.get("token") || "").trim());
  if (!who.ok) return who;

  const toolId = String(fd.get("tool_id") || "").trim();
  const qty = qtyOf(fd, "qty");
  if (!toolId) return { ok: false, error: "Which tool?" };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "How many came in?" };
  if (qty > 10_000) return { ok: false, error: "That is a lot — add it on the office screen." };

  // Daksh, Nov 2026: "in add stock when we add stock it should give
  // option or field to add note like it shows in laptop." His note
  // first, then who put it in — the bill number is what somebody
  // reading the register back in six months is looking for.
  const typed = String(fd.get("note") || "").trim().slice(0, 220);
  const note = typed
    ? `${typed} · added at the cupboard by ${who.name}`
    : `Added at the cupboard by ${who.name}`;

  const admin = createAdminSupabaseClient();
  const { data: raw, error } = await admin.rpc("cnc_tool_record_move", {
    p_tool_id: toolId,
    p_kind: "receive",
    p_delta: qty,
    p_note: note,
    p_entered_by: who.profileId,
  });
  if (error) return { ok: false, error: error.message };
  const res = (raw ?? {}) as MoveOutcome;
  if (!res.ok) return { ok: false, error: moveRefusal(res) };

  revalidatePath(`/guest/tools/${String(fd.get("token") || "").trim()}`);
  revalidatePath("/tools");
  return { ok: true, message: `${res.tool}: ${res.stock_after} ${res.unit} on the shelf.` };
}

/** The shelf says one thing and the register another. The shelf wins. */
export async function keeperFixCountAction(fd: FormData): Promise<KeeperResult> {
  const who = await keeperAt(String(fd.get("token") || "").trim());
  if (!who.ok) return who;

  const toolId = String(fd.get("tool_id") || "").trim();
  const counted = qtyOf(fd, "counted");
  if (!toolId) return { ok: false, error: "Which tool?" };
  if (!Number.isInteger(counted) || counted < 0) {
    return { ok: false, error: "What does the shelf say? A whole number, 0 or more." };
  }

  const admin = createAdminSupabaseClient();
  // An absolute count, so a take landing mid-count cannot bend it
  // (mig 235). The delta is worked out inside the lock.
  const { data: raw, error } = await admin.rpc("cnc_tool_record_move", {
    p_tool_id: toolId,
    p_kind: "adjust",
    p_target: counted,
    p_note: `Counted at the cupboard by ${who.name}`,
    p_entered_by: who.profileId,
  });
  if (error) return { ok: false, error: error.message };
  const res = (raw ?? {}) as MoveOutcome;
  if (!res.ok) return { ok: false, error: moveRefusal(res) };
  if (res.noop) return { ok: true, message: `${res.tool} was already ${counted}.` };

  return (
    revalidatePath(`/guest/tools/${String(fd.get("token") || "").trim()}`),
    revalidatePath("/tools"),
    { ok: true, message: `${res.tool} put right: ${res.stock_after} ${res.unit}.` }
  );
}

/** Something on the shelf that the store has never heard of. */
export async function keeperNewToolAction(fd: FormData): Promise<KeeperResult> {
  const token = String(fd.get("token") || "").trim();
  const who = await keeperAt(token);
  if (!who.ok) return who;

  const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ");
  const unit = String(fd.get("unit") || "").trim() || "pcs";
  const opening = qtyOf(fd, "opening");

  if (name.length < 2) return { ok: false, error: "Give the tool a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  if (!Number.isInteger(opening) || opening < 0) {
    return { ok: false, error: "How many are on the shelf right now? 0 is fine." };
  }

  const admin = createAdminSupabaseClient();
  const { data: created, error } = await admin
    .from("cnc_tools")
    .insert({ name, unit, created_by: who.profileId, updated_by: who.profileId })
    .select("id, name")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `"${name}" is already in the store.` };
    return { ok: false, error: error.message };
  }
  if (!created) return { ok: false, error: "Could not add it. Try again." };
  const tool = created as { id: string; name: string };

  // The photo goes up after the row, under the tool's own id, so a
  // failed upload costs a picture and never the tool.
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const mime = (photo.type || "").toLowerCase();
    const ok = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime);
    if (ok && photo.size <= 8 * 1024 * 1024) {
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `${tool.id}/${Date.now().toString(36)}.${ext}`;
      const up = await admin.storage
        .from(TOOL_IMAGE_BUCKET)
        .upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: mime, upsert: false });
      if (!up.error) await admin.from("cnc_tools").update({ image_path: path }).eq("id", tool.id);
    }
  }

  if (opening > 0) {
    // A normal receive line, so the opening count shows WHERE it came
    // from instead of appearing out of nowhere above an empty register.
    await admin.rpc("cnc_tool_record_move", {
      p_tool_id: tool.id,
      p_kind: "receive",
      p_delta: opening,
      p_note: `Opening stock, added at the cupboard by ${who.name}`,
      p_entered_by: who.profileId,
    });
  }

  revalidatePath(`/guest/tools/${token}`);
  revalidatePath("/tools");
  return {
    ok: true,
    message: opening > 0
      ? `${tool.name} added with ${opening} ${unit}.`
      : `${tool.name} added. Put some stock in when it arrives.`,
  };
}

// ──────────────────────────────────────────────────────────────────
// The register, on the phone (Daksh, Nov 2026)
//
// "In phone also you need to give timeline — who take what and when.
//  Maybe a new page where everything will be registered, that Mohit
//  took this at that time, in a good visualisation view, timeline. So
//  user can see what they took, or others."
//
// The office screen has had this since the module was built. The men
// standing at the cupboard — the ones who actually take the tools —
// could see only what they had taken in that one visit, which vanished
// when they signed out. The paper register this replaces was nailed to
// the wall and ANYONE could read back a month of it, which is most of
// why a paper register works at all.
//
// So: everybody who can sign in at the cupboard can read it, their own
// lines and everyone else's. That is deliberate. A shared cupboard with
// a private register is how an argument about a missing box starts.
//
// Read-only, capped, and scoped to nothing but time — there is no
// filtering by person on the server, because the point is that it
// cannot be edited or narrowed by the person being asked about it.
// ──────────────────────────────────────────────────────────────────

/** One line of the cupboard's register, as a phone wants to read it. */
export type RegisterLine = {
  id: string;
  /** ISO. Grouped into days and clock times on the client, in IST. */
  at: string;
  /** The five movement kinds, plus "use" — a tool spent on a machine
   *  (mig 238), which is not a movement at all but belongs in the same
   *  story. Leaving it out would make the register lie: a man would see
   *  himself take five and never see where four of them went. */
  kind: string;
  /** Signed: negative is a take, positive is stock arriving. A "use"
   *  carries negative too — it leaves his hands — but it is the one
   *  kind that does NOT move the shelf. */
  delta: number;
  toolName: string;
  unit: string;
  /** Mig 238 — which CNC it was spent on. Only ever set on a "use". */
  machineCode: string | null;
  /** Who did it. Null means the store itself — a delivery with no
   *  name against it. */
  personName: string | null;
  company: string | null;
  /** Was this me? Decided on the server from the session, never from
   *  a name typed on the page. */
  mine: boolean;
  note: string | null;
  undone: boolean;
};

export type RegisterResult =
  | { ok: true; lines: RegisterLine[]; truncated: boolean }
  | { ok: false; error: string; signedOut?: boolean };

/** How far back the phone reads. Six weeks is longer than any argument
 *  about a missing box, and short enough to stay one quick query. */
const REGISTER_DAYS = 42;
const REGISTER_MAX = 300;

export async function guestRegisterAction(fd: FormData): Promise<RegisterResult> {
  const token = String(fd.get("token") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not valid. Ask the office for the new one." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }

  const admin = createAdminSupabaseClient();
  const since = new Date(Date.now() - REGISTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ── Whose register is this? ─────────────────────────────────
  //
  // Daksh, Nov 2026: "the register in phone — owner and developer can
  // see all activity, but the respective vendor will see theirs only."
  //
  // Until now every signed-in person read the whole cupboard, which
  // meant Mohit could stand at the wardrobe and read what Manthan's
  // shed had taken all week. That is the company's business and not
  // his, and it is the sort of thing nobody complains about until the
  // day two vendors are quoting against each other.
  //
  // The office — no vendor_id — still sees everything, because that is
  // the whole point of the register for them. A vendor sees his own
  // firm's lines and nothing else.
  //
  // Scoped in the QUERY, not in the map below. A filter applied after
  // the fetch still pulls another firm's rows across the wire, where a
  // network tab would show them.
  const mineOnly = !!session.vendorId;

  let moveQ = admin
    .from("cnc_tool_movements")
    .select(
      "id, tool_id, kind, delta, taken_by, taken_by_profile_id, taken_by_operator_id, vendor_id, note, created_at, undone_at",
    )
    .gte("created_at", since);
  if (mineOnly) moveQ = moveQ.eq("vendor_id", session.vendorId!);

  // Two ledgers, one story. The shelf's movements and mig 238's usage
  // rows are read separately — they are different tables about different
  // things — and merged on time, because a man reading his own register
  // does not care which table a line came out of.
  const [{ data: rows, error }, uses] = await Promise.all([
    moveQ
      .order("created_at", { ascending: false })
      .limit(REGISTER_MAX + 1),
    usageLinesSince(
      since,
      {
        profileId: session.profileId,
        operatorId: session.operatorId,
        vendorId: mineOnly ? session.vendorId : null,
      },
      REGISTER_MAX + 1,
    ),
  ]);
  if (error) return { ok: false, error: error.message };

  const all = (rows ?? []) as Array<{
    id: string; tool_id: string; kind: string; delta: number | string;
    taken_by: string | null; taken_by_profile_id: string | null;
    taken_by_operator_id: string | null; vendor_id: string | null;
    note: string | null; created_at: string; undone_at: string | null;
  }>;
  const lines = all;

  // Names, in two small lookups rather than a join per row.
  const toolIds = [...new Set(lines.map((l) => l.tool_id))];
  const vendorIds = [...new Set(lines.map((l) => l.vendor_id).filter(Boolean))] as string[];

  const [{ data: toolRows }, { data: vendorRows }] = await Promise.all([
    toolIds.length
      ? admin.from("cnc_tools").select("id, name, unit").in("id", toolIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; unit: string }> }),
    vendorIds.length
      ? admin.from("vendors").select("id, name").in("id", vendorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const tools = new Map(
    ((toolRows ?? []) as Array<{ id: string; name: string; unit: string }>).map((t) => [t.id, t]),
  );
  const vendors = new Map(
    ((vendorRows ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name]),
  );

  const moved: RegisterLine[] = lines.map((l) => {
    const tool = tools.get(l.tool_id);
    return {
      id: l.id,
      at: l.created_at,
      kind: l.kind,
      delta: Number(l.delta),
      toolName: tool?.name ?? "a tool that has since been removed",
      unit: tool?.unit ?? "pcs",
      machineCode: null,
      personName: l.taken_by,
      company: l.vendor_id ? vendors.get(l.vendor_id) ?? null : null,
      // Identity comes off the session, so nobody can make a line
      // look like somebody else's by editing what is on the page.
      mine:
        (!!session.profileId && l.taken_by_profile_id === session.profileId) ||
        (!!session.operatorId && l.taken_by_operator_id === session.operatorId),
      note: l.note,
      undone: !!l.undone_at,
    };
  });

  const spent: RegisterLine[] = uses.map((u) => ({
    id: `use:${u.id}`,
    at: u.createdAt,
    kind: "use",
    // Negative because it leaves him, the same way a take does. The
    // screen is what draws the distinction between "off the shelf" and
    // "into a machine"; the sign only says which direction.
    delta: -u.qty,
    toolName: u.toolName,
    unit: u.unit,
    machineCode: u.machineCode,
    personName: u.usedBy,
    company: u.company,
    mine: u.mine,
    note: null,
    undone: !!u.undoneAt,
  }));

  const merged = [...moved, ...spent].sort((a, b) => b.at.localeCompare(a.at));
  const truncated = merged.length > REGISTER_MAX;

  return { ok: true, truncated, lines: truncated ? merged.slice(0, REGISTER_MAX) : merged };
}

// ──────────────────────────────────────────────────────────────────
// What happens to a tool after he has it (mig 238)
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "Mohit took 5 pcs of some tool, then this 5 pcs will
// show in his account… he will then do 1 pcs used in CNC no 14."
//
// Two writes, both guarded by the same thing: a man can only account
// for what he is actually holding. That ceiling is read inside a lock
// in the database (mig 238) and not here, because custody is derived
// and two taps on a bad signal would otherwise both pass a check made
// in TypeScript.

export type MyToolsResult =
  | { ok: true; items: HeldItem[] }
  | { ok: false; error: string; signedOut?: boolean };

/** His account: what he took and has not yet spent or given back. */
export async function guestMyToolsAction(fd: FormData): Promise<MyToolsResult> {
  const token = String(fd.get("token") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not valid. Ask the office for the new one." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }

  return { ok: true, items: await holdingsForPerson(session.profileId, session.operatorId) };
}

export type SettleResult =
  | {
      ok: true;
      outcome: "used" | "returned";
      /** Set on a usage, so the phone can offer to take it back. */
      usageId: string | null;
      toolName: string;
      qty: number;
      machine: string | null;
      /** What is left in his hands afterwards. */
      left: number;
      items: HeldItem[];
    }
  | { ok: false; error: string; signedOut?: boolean };

/**
 * One pc leaves his hands — spent on a machine, or back on the shelf.
 *
 * Both outcomes go through one function here and one function in the
 * database for the same reason: they are the same operation seen from
 * his account, and the ceiling that makes either of them safe is the
 * same number.
 */
export async function guestSettleHeldAction(fd: FormData): Promise<SettleResult> {
  const token = String(fd.get("token") || "").trim();
  const toolId = String(fd.get("tool_id") || "").trim();
  const outcome = String(fd.get("outcome") || "").trim();
  const machineId = String(fd.get("machine_id") || "").trim();
  const qty = Number(fd.get("qty"));

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return {
      ok: false,
      error:
        resolved.problem === "revoked"
          ? "This QR has been switched off. Ask the office for the new one."
          : "This QR is not valid. Ask the office for the new one.",
    };
  }
  const link = resolved.link;

  const session = await currentToolSession(token, link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }

  if (outcome !== "used" && outcome !== "returned") {
    return { ok: false, error: "Pick what happened to it." };
  }
  if (!toolId) return { ok: false, error: "Pick a tool first." };
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
    return { ok: false, error: "How many? Enter at least 1." };
  }
  if (qty > MAX_USE_QTY) {
    return { ok: false, error: `That is a lot — ${MAX_USE_QTY} is the most in one go.` };
  }
  if (outcome === "used" && !machineId) {
    return { ok: false, error: "Which machine? Tap one first." };
  }

  const admin = createAdminSupabaseClient();

  // The day's ceiling on this sticker, counting both ledgers — a
  // runaway QR writes usage rows just as happily as it writes takes.
  const [takes, uses] = await Promise.all([
    takesThroughLinkToday(link.id),
    usesThroughLinkToday(link.id),
  ]);
  if (takes + uses >= link.dailyCap) {
    return {
      ok: false,
      error: "This QR has recorded a lot today and is paused until tomorrow. Tell the office.",
    };
  }

  const { data: raw, error } = await admin.rpc("cnc_tool_settle_held", {
    p_tool_id: toolId,
    p_outcome: outcome,
    p_qty: qty,
    p_machine_id: outcome === "used" ? machineId : null,
    p_profile_id: session.profileId,
    p_operator_id: session.operatorId,
    p_used_by: session.name,
    p_vendor_id: session.vendorId,
    p_guest_link: link.id,
  });
  if (error) return { ok: false, error: error.message };

  const res = (raw ?? {}) as SettleOutcome;
  // The unit is dropped: the cupboard screen already says PCS in big
  // letters beside every number.
  if (!res.ok) return { ok: false, error: settleRefusal(res, { unit: false }) };

  await admin
    .from("cnc_tool_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  revalidatePath("/tools");

  return {
    ok: true,
    outcome: res.outcome ?? (outcome as "used" | "returned"),
    usageId: res.usage_id ?? null,
    toolName: res.tool ?? "tool",
    qty,
    machine: res.machine ?? null,
    left: Number(res.holding_after ?? 0),
    // Handed back so the account on screen is the account in the
    // database, with no second round-trip and no stale number.
    items: await holdingsForPerson(session.profileId, session.operatorId),
  };
}

/**
 * Take back a usage line, inside the ten minutes.
 *
 * A wrong machine number is the easy mistake on this screen and it goes
 * straight into a costing report, so it has to be undoable. A soft void,
 * like everything else in this module: the line stays in the register
 * with a stroke through it, and the pc goes back into his hands.
 *
 * Only his own, and only his own: the id is checked against the session
 * rather than trusted, so a edited form cannot void somebody else's.
 */
export async function guestUndoUsageAction(fd: FormData): Promise<SettleResult> {
  const token = String(fd.get("token") || "").trim();
  const usageId = String(fd.get("usage_id") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not valid. Ask the office for the new one." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false, error: "Your sign-in has run out. Tap your name again.", signedOut: true };
  }
  if (!usageId) return { ok: false, error: "Nothing to take back." };

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_usage")
    .select("id, qty, created_at, undone_at, used_by_profile_id, used_by_operator_id, cnc_tools(name)")
    .eq("id", usageId)
    .maybeSingle();

  const row = data as
    | {
        id: string; qty: number | string; created_at: string; undone_at: string | null;
        used_by_profile_id: string | null; used_by_operator_id: string | null;
        cnc_tools: { name: string } | { name: string }[] | null;
      }
    | null;
  if (!row) return { ok: false, error: "Nothing to take back." };

  const isMine =
    (!!session.profileId && row.used_by_profile_id === session.profileId) ||
    (!!session.operatorId && row.used_by_operator_id === session.operatorId);
  if (!isMine) return { ok: false, error: "That one is not yours to take back." };
  if (row.undone_at) return { ok: false, error: "That one is already taken back." };
  if (!canUndoUsage({ createdAt: row.created_at, undoneAt: row.undone_at })) {
    return { ok: false, error: "Too late to take that back. Tell the office." };
  }

  // A no-op if somebody got there first: the WHERE clause is the lock.
  const { data: done, error } = await admin
    .from("cnc_tool_usage")
    .update({
      undone_at: new Date().toISOString(),
      // Whichever kind of person he is. An operator has no profile, so
      // writing undone_by alone would leave the mark with no undoer and
      // the pair CHECK would refuse it (mig 238).
      undone_by: session.profileId,
      undone_by_operator_id: session.operatorId,
    })
    .eq("id", usageId)
    .is("undone_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!done) return { ok: false, error: "That one is already taken back." };

  revalidatePath("/tools");

  const toolName =
    (Array.isArray(row.cnc_tools) ? row.cnc_tools[0] : row.cnc_tools)?.name ?? "tool";
  const items = await holdingsForPerson(session.profileId, session.operatorId);

  return {
    ok: true,
    outcome: "returned",
    usageId: null,
    toolName,
    qty: Number(row.qty),
    machine: null,
    left: items.find((i) => i.name === toolName)?.qty ?? 0,
    items,
  };
}
