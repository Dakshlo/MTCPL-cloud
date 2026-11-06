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
import { canSignInAtCupboard } from "@/lib/cnc-tool-permissions";
import { issueActionOtp, verifyActionOtp } from "@/lib/action-otp";
import {
  GUEST_MAX_QTY,
  resolveToolStoreLink,
  takesThroughLinkToday,
} from "@/lib/cnc-tool-guest";
import { moveRefusal, type MoveOutcome } from "@/lib/cnc-tool-stock";
import {
  SESSION_HOURS,
  TOOL_OTP_DIGITS,
  currentToolSession,
  enrollableVendors,
  sessionCookieName,
  startToolSession,
} from "@/lib/cnc-tool-session";
import {
  allActiveOperators,
  operatorsForVendor,
  phoneAlreadyTaken,
  phoneDigits,
  phoneProblem,
  type ToolOperator,
} from "@/lib/cnc-tool-operators";

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
  kind: "profile" | "operator";
  /** What the OTP is bound to. Namespaced, so an operator's code can
   *  never be replayed against a profile that happens to share an id. */
  subjectId: string;
  /** action_otps.requested_by is NOT NULL and points at profiles; an
   *  operator borrows the profile of the vendor who enrolled him. */
  requestedBy: string;
  profileId: string | null;
  operatorId: string | null;
  name: string;
  phone: string;
  vendorId: string | null;
};

async function resolveSigner(
  kind: string,
  id: string,
): Promise<{ ok: true; signer: Signer } | { ok: false; error: string }> {
  const gone = { ok: false as const, error: "That name is not on the list any more." };
  if (!id) return { ok: false, error: "Tap your name first." };

  const admin = createAdminSupabaseClient();

  if (kind === "operator") {
    const { data } = await admin
      .from("cnc_tool_operators")
      .select("id, name, phone, vendor_id, enrolled_by, is_active")
      .eq("id", id)
      .maybeSingle();
    const o = data as
      | { id: string; name: string; phone: string; vendor_id: string; enrolled_by: string; is_active: boolean }
      | null;
    if (!o || !o.is_active) return gone;
    return {
      ok: true,
      signer: {
        kind: "operator",
        subjectId: `cnc_op:${o.id}`,
        requestedBy: o.enrolled_by,
        profileId: null,
        operatorId: o.id,
        name: (o.name || "Unnamed").trim(),
        phone: o.phone,
        vendorId: o.vendor_id,
      },
    };
  }

  const { data } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, vendor_id, can_keep_tool_store")
    .eq("id", id)
    .maybeSingle();
  const p = data as
    | {
        id: string; full_name: string | null; phone: string | null; role: string;
        is_active: boolean; vendor_id: string | null; can_keep_tool_store: boolean | null;
      }
    | null;
  // The same rule the roster was drawn with, applied again against the
  // database — the list is HTML and HTML can be edited.
  if (!p || !p.is_active || !canSignInAtCupboard(p as Parameters<typeof canSignInAtCupboard>[0])) {
    return gone;
  }

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
      vendorId: p.vendor_id,
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
  | { ok: true; name: string }
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
  // what puts a take under MOHIT in the office register, and for an
  // operator it is the only thing that says whose man he is.
  return { ok: true, name: signer.name };
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

export type GuestTakeResult =
  | { ok: true; left: number; toolName: string; qty: number }
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

  return {
    ok: true,
    left: Number(res.stock_after ?? 0),
    toolName: res.tool ?? "tool",
    qty,
  };
}

// ──────────────────────────────────────────────────────────────────
// A vendor's own men (mig 234)
// ──────────────────────────────────────────────────────────────────
// Daksh: "eg i am mohit, i scan the qr code, enter otp, i see place
// where i can add operator eg shyam and his number."
//
// Three rules hold this door shut, and all three are checked here
// rather than in the screen that draws the buttons:
//
//   1. you must hold a live OTP session at this sticker
//   2. that session must be a VENDOR PRINCIPAL — the man whose company
//      it is. An operator cannot grow a team of his own, and the
//      developer has no company to grow one under.
//   3. you may only ever touch your OWN company's men
//
// What this creates is NOT an app login. See mig 234 for why that line
// matters more than it looks.

export type TeamMember = {
  id: string;
  name: string;
  maskedPhone: string;
  /** Only filled on the developer's view, where one list covers all
   *  three companies and the name alone would not say whose man it is. */
  company?: string;
};

export type TeamResult =
  | { ok: true; team: TeamMember[]; message?: string }
  | { ok: false; error: string };

const asTeam = (rows: ToolOperator[], withCompany = false): TeamMember[] =>
  rows.map((o) => ({
    id: o.id,
    name: o.name,
    maskedPhone: o.maskedPhone,
    ...(withCompany ? { company: o.vendorName } : {}),
  }));

/**
 * The signed-in person, if they may manage a team at all.
 *
 * Two shapes. A vendor principal manages HIS OWN men and the company
 * is fixed by his session — a tampered form cannot reach another
 * firm's list. The developer manages all three and therefore has to
 * say which, so the company arrives on the form and is checked against
 * the companies that actually have an account.
 */
async function enrollingVendor(token: string, wantVendorId?: string) {
  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false as const, error: "This QR is not working. Ask the office." };
  }
  const session = await currentToolSession(token, resolved.link.id);
  if (!session) {
    return { ok: false as const, error: "Your sign-in has run out. Tap your name again." };
  }
  if (!session.canEnrol || !session.profileId) {
    return { ok: false as const, error: "Only a vendor can change a team." };
  }

  if (session.enrolScope === "own") {
    if (!session.vendorId) {
      return { ok: false as const, error: "Only a vendor can change a team." };
    }
    return {
      ok: true as const,
      scope: "own" as const,
      vendorId: session.vendorId,
      profileId: session.profileId,
    };
  }

  // The developer. No company of his own, so one has to be named.
  const picked = (wantVendorId ?? "").trim();
  if (!picked) {
    return { ok: true as const, scope: "any" as const, vendorId: null, profileId: session.profileId };
  }
  const allowed = await enrollableVendors();
  if (!allowed.some((v) => v.id === picked)) {
    return { ok: false as const, error: "That is not one of the vendors." };
  }
  return { ok: true as const, scope: "any" as const, vendorId: picked, profileId: session.profileId };
}

/** Who is on the team right now — mine, or everybody's. */
export async function myTeamAction(fd: FormData): Promise<TeamResult> {
  const who = await enrollingVendor(String(fd.get("token") || "").trim());
  if (!who.ok) return who;
  if (who.scope === "any") {
    return { ok: true, team: asTeam(await allActiveOperators(), true) };
  }
  return { ok: true, team: asTeam(await operatorsForVendor(who.vendorId!)) };
}

/** The list after a change, in whichever shape this signer sees. */
async function teamFor(scope: "own" | "any", vendorId: string | null): Promise<TeamMember[]> {
  return scope === "any"
    ? asTeam(await allActiveOperators(), true)
    : asTeam(await operatorsForVendor(vendorId!));
}

/** Add one of my men. Name and number, nothing else — anything more
 *  and a vendor standing at a cupboard will not finish the form. */
export async function enrolOperatorAction(fd: FormData): Promise<TeamResult> {
  const who = await enrollingVendor(
    String(fd.get("token") || "").trim(),
    String(fd.get("vendor_id") || "").trim(),
  );
  if (!who.ok) return who;
  if (!who.vendorId) return { ok: false, error: "Pick which vendor he works for." };

  const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ");
  const phoneRaw = String(fd.get("phone") || "").trim();

  if (name.length < 2) return { ok: false, error: "Write his name." };
  if (name.length > 60) return { ok: false, error: "That name is too long." };

  const bad = phoneProblem(phoneRaw);
  if (bad) return { ok: false, error: bad };

  const clash = await phoneAlreadyTaken(phoneRaw);
  if (clash) return { ok: false, error: clash };

  // Stored with the country code, the same shape the profiles carry, so
  // the SMS gateway sees one format whoever it is sending to.
  const phone = `91${phoneDigits(phoneRaw).slice(-10)}`;

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("cnc_tool_operators").insert({
    vendor_id: who.vendorId,
    enrolled_by: who.profileId,
    name,
    phone,
  });
  const vendorId = who.vendorId;
  if (error) {
    // 23505 = the one-live-operator-per-number index. Two phones racing
    // the same enrolment land here rather than making two of him.
    if (error.code === "23505") return { ok: false, error: "That number is already on a team." };
    return { ok: false, error: error.message };
  }

  revalidatePath(`/guest/tools/${String(fd.get("token") || "").trim()}`);
  revalidatePath("/tools");
  return {
    ok: true,
    team: await teamFor(who.scope, vendorId),
    message: `${name} can now sign in at the cupboard.`,
  };
}

/** Take one of my men off the list.
 *
 *  Not a delete: the row is switched off, so every tool he has already
 *  taken keeps his name against it in the register. His live session
 *  dies with it — currentToolSession re-reads is_active on every take. */
export async function removeOperatorAction(fd: FormData): Promise<TeamResult> {
  const token = String(fd.get("token") || "").trim();
  const who = await enrollingVendor(token);
  if (!who.ok) return who;

  const operatorId = String(fd.get("operator_id") || "").trim();
  if (!operatorId) return { ok: false, error: "Which man?" };

  const admin = createAdminSupabaseClient();
  // A vendor is pinned to his own company, so a tampered form cannot
  // reach another firm's man. The developer is not pinned, because
  // all three teams are his to clean up.
  let q = admin
    .from("cnc_tool_operators")
    .update({
      is_active: false,
      removed_at: new Date().toISOString(),
      removed_by: who.profileId,
    })
    .eq("id", operatorId)
    .eq("is_active", true);
  if (who.scope === "own") q = q.eq("vendor_id", who.vendorId!);

  const { data, error } = await q.select("name").maybeSingle();
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/guest/tools/${token}`);
  revalidatePath("/tools");
  const gone = (data as { name: string } | null)?.name;
  return {
    ok: true,
    team: await teamFor(who.scope, who.vendorId),
    message: gone ? `${gone} taken off the list.` : "Already off the list.",
  };
}
