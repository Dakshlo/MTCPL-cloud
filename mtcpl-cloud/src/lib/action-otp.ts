// ──────────────────────────────────────────────────────────────────
// One-time codes that authorise a destructive in-app action (mig 226).
//
// Daksh, Sep 2026: archiving a fully-paid bill is owner-only, and he
// asked for an OTP instead of another stack of "are you sure?" dialogs.
// That is the right instinct — a second confirm button becomes muscle
// memory within a week, while a code that has to arrive on your phone
// cannot be clicked through by accident, and cannot be done by someone
// who has walked up to an unlocked screen.
//
// Deliberately NOT built on lib/short-otp.ts. That one is the login
// path: it pairs an EASY-SHAPE 4-digit code (2299, 6699 — about 300
// possibilities) with the real six Supabase issued. Nothing here can
// mint a session; these codes are checked against this table and
// nothing else.
//
// FOUR DIGITS, at Daksh's instruction (Sep 2026), and RANDOM — the full
// 10,000, not the login's ~300 easy shapes. With the 3-attempt cap that
// is a 3-in-10,000 chance of guessing a live code, about 1 in 3,300.
// Worth writing down why that is a fair trade here, rather than leaving
// it to look like an oversight: to reach this prompt at all you must
// already hold an owner session, the code goes to the owner's own phone
// and never to anything the page supplied, it dies after three wrong
// tries or ten minutes, and the worst an attacker achieves is HIDING a
// fully-paid bill — which the developer restores in one click, with the
// payments and audit trail untouched throughout. A wrong outcome here
// is cheap and completely reversible, so two more digits bought little.
//
// Shape:
//   • the code is hashed (sha256) at rest; the plaintext exists only in
//     the SMS
//   • bound to (action, subject_id) — a code issued to archive bill A
//     can never archive bill B
//   • 10-minute expiry, 3 attempts, then it is spent
//   • requesting a new code supersedes any live one for that subject,
//     so a stale SMS cannot be used later
// ──────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendOtpSms } from "@/lib/msg91";
import { CODE_LENGTH } from "@/lib/otp-shape";

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 3;

const hash = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

/** Four random digits from a CSPRNG — uniform over 0000–9999, and the
 *  whole range, not the login's easy shapes. crypto.randomInt rejection-
 *  samples internally, so there is no modulo bias. */
function newCode(): string {
  return String(crypto.randomInt(0, 10_000)).padStart(CODE_LENGTH, "0");
}

/** Mask a phone for display: "9799868196" → "•••••• 8196". */
export function maskPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length < 4) return "your registered number";
  return `•••••• ${d.slice(-4)}`;
}

export type IssueResult =
  | { ok: true; sentTo: string }
  | { ok: false; error: string };

/** Generate, store and SMS a code for one action on one subject. */
export async function issueActionOtp(opts: {
  action: string;
  subjectId: string;
  requestedBy: string;
  phone: string;
}): Promise<IssueResult> {
  const { action, subjectId, requestedBy, phone } = opts;
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "No mobile number on that account to send a code to." };
  }
  const admin = createAdminSupabaseClient();

  // Supersede any live code for this subject, so an older SMS stops
  // working the moment a new one is asked for.
  await admin
    .from("action_otps")
    .update({ consumed_at: new Date().toISOString() } as never)
    .eq("action", action)
    .eq("subject_id", subjectId)
    .is("consumed_at", null);

  const code = newCode();
  const { error } = await admin.from("action_otps").insert({
    action,
    subject_id: subjectId,
    requested_by: requestedBy,
    sent_to: phone,
    code_hash: hash(code),
    expires_at: new Date(Date.now() + TTL_MINUTES * 60_000).toISOString(),
  } as never);
  if (error) return { ok: false, error: error.message };

  try {
    // Reuses the DLT-approved login OTP template — it is still an OTP,
    // so no new template approval is needed to ship this.
    await sendOtpSms(phone, code);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send the code." };
  }
  return { ok: true, sentTo: maskPhone(phone) };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string; attemptsLeft?: number };

/** Check a typed code and spend it. Never says whether the code merely
 *  expired or was wrong beyond what the operator needs to retry. */
export async function verifyActionOtp(opts: {
  action: string;
  subjectId: string;
  code: string;
}): Promise<VerifyResult> {
  const { action, subjectId } = opts;
  const typed = (opts.code || "").replace(/\D/g, "");
  if (typed.length !== CODE_LENGTH) {
    return { ok: false, error: `Enter the ${CODE_LENGTH}-digit code.` };
  }

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("action_otps")
    .select("id, code_hash, attempts, expires_at")
    .eq("action", action)
    .eq("subject_id", subjectId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = (data ?? [])[0] as
    | { id: string; code_hash: string; attempts: number; expires_at: string }
    | undefined;
  if (!row) return { ok: false, error: "No code is waiting. Ask for a new one." };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }

  if (hash(typed) !== row.code_hash) {
    const attempts = (row.attempts ?? 0) + 1;
    const spent = attempts >= MAX_ATTEMPTS;
    await admin
      .from("action_otps")
      .update({ attempts, ...(spent ? { consumed_at: new Date().toISOString() } : {}) } as never)
      .eq("id", row.id);
    return spent
      ? { ok: false, error: "Wrong code 3 times — that code is now dead. Ask for a new one." }
      : { ok: false, error: "Wrong code.", attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  // Correct: spend it immediately so it cannot be replayed.
  await admin
    .from("action_otps")
    .update({ consumed_at: new Date().toISOString() } as never)
    .eq("id", row.id);
  return { ok: true };
}
