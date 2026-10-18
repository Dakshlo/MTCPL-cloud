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
import { issueActionOtp, verifyActionOtp } from "@/lib/action-otp";
import {
  GUEST_MAX_QTY,
  resolveToolStoreLink,
  takesThroughLinkToday,
} from "@/lib/cnc-tool-guest";
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
  const profileId = String(fd.get("profile_id") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) {
    return { ok: false, error: "This QR is not working. Ask the office." };
  }
  if (!profileId) return { ok: false, error: "Tap your name first." };

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active")
    .eq("id", profileId)
    .maybeSingle();

  const p = data as
    | { id: string; full_name: string | null; phone: string | null; role: string; is_active: boolean }
    | null;

  // Re-check the roster rule here, not just in the page that drew the
  // list — the list is HTML and HTML can be edited.
  if (!p || !p.is_active || !["vendor", "developer"].includes(p.role)) {
    return { ok: false, error: "That name is not on the list any more." };
  }

  return issueActionOtp({
    action: OTP_ACTION,
    subjectId: p.id,
    requestedBy: p.id,
    phone: p.phone ?? "",
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
  const profileId = String(fd.get("profile_id") || "").trim();
  const code = String(fd.get("code") || "").trim();

  const resolved = await resolveToolStoreLink(token);
  if ("problem" in resolved) return { ok: false, error: "This QR is not working. Ask the office." };
  const link = resolved.link;

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active, vendor_id")
    .eq("id", profileId)
    .maybeSingle();
  const p = data as
    | { id: string; full_name: string | null; role: string; is_active: boolean; vendor_id: string | null }
    | null;
  if (!p || !p.is_active || !["vendor", "developer"].includes(p.role)) {
    return { ok: false, error: "That name is not on the list any more." };
  }

  const check = await verifyActionOtp({
    action: OTP_ACTION,
    subjectId: p.id,
    code,
    digits: TOOL_OTP_DIGITS,
  });
  if (!check.ok) return { ok: false, error: check.error, attemptsLeft: check.attemptsLeft };

  const sessionToken = await startToolSession({
    profileId: p.id,
    linkId: link.id,
    vendorId: p.vendor_id,
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

  // The session still carries the person's own company when they have
  // one — it costs nothing and keeps the older rows comparable. Nobody
  // is ASKED for it any more (mig 232); the code to their phone is the
  // signature, and the company adds nothing the person did not say.
  return { ok: true, name: (p.full_name || "Unnamed").trim() };
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

  // ── 5. The tool, and whether the shelf can cover it ──────────────
  const { data: tool } = await admin
    .from("cnc_tools")
    .select("id, name, is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (!tool || !(tool as { is_active: boolean }).is_active) {
    return { ok: false, error: "That tool is no longer in the store." };
  }
  const toolName = (tool as { name: string }).name;

  // Stock is the sum of the register, never a stored number.
  const { data: moves } = await admin
    .from("cnc_tool_movements")
    .select("delta")
    .eq("tool_id", toolId)
    .is("undone_at", null);
  const stock = (moves ?? []).reduce(
    (s, m) => s + Number((m as { delta: number | string }).delta ?? 0),
    0,
  );
  if (stock <= 0) return { ok: false, error: `${toolName} is finished. Tell the office.` };
  if (qty > stock) {
    return { ok: false, error: `Only ${stock} left on the shelf. Take ${stock} or fewer.` };
  }

  // ── 6. Record it ─────────────────────────────────────────────────
  // taken_by keeps the readable name every existing screen already
  // shows; taken_by_profile_id is the part that cannot be typed.
  const { error } = await admin.from("cnc_tool_movements").insert({
    // Whatever company the person belongs to, if any — never asked for,
    // never required (mig 232). taken_by_profile_id is the signature.
    vendor_id: session.vendorId,
    tool_id: toolId,
    kind: "issue",
    delta: -Math.abs(qty),
    taken_by: session.name,
    taken_by_profile_id: session.profileId,
    guest_link_id: link.id,
  });
  if (error) return { ok: false, error: error.message };

  await admin
    .from("cnc_tool_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  revalidatePath("/tools");

  return { ok: true, left: stock - qty, toolName, qty };
}
