"use server";

// ──────────────────────────────────────────────────────────────────
// Verify a login code on the SERVER.
//
// This is the change that matters most in the short-OTP work. The
// browser used to call supabase.auth.verifyOtp directly, which meant
// any "3 attempts" limit lived in React state and a script could just
// ignore it. Verification now happens here, so the cap is real.
//
// Flow:
//   1. The typed 4-digit code is checked against the stored pair
//      (attempts + cooldown enforced in lib/short-otp).
//   2. On success we replay Supabase's REAL six-digit code to
//      supabase.auth.verifyOtp from a server client — which sets the
//      auth cookies exactly as the browser call used to.
//   3. Supabase still mints every session. We only shortened what a
//      human types.
//
// Fallback, deliberately kept: a 6-digit entry is passed straight
// through to Supabase. If anything about the short-code store is
// broken, the code Supabase sent still logs you in. Nobody gets
// stranded because this feature failed.
// ──────────────────────────────────────────────────────────────────

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyShortCode, cooldownRemaining, MAX_ATTEMPTS } from "@/lib/short-otp";

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string; attemptsLeft?: number; cooldownMs?: number; burned?: boolean };

function coolMsg(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  return mins <= 1 ? "Wait a minute and ask for a new code." : `Wait ${mins} minutes and ask for a new code.`;
}

export async function verifyLoginOtpAction(
  phoneRaw: string,
  codeRaw: string,
): Promise<VerifyResult> {
  const phone = String(phoneRaw || "").trim();
  const code = String(codeRaw || "").replace(/\D/g, "");
  if (!phone || !code) return { ok: false, error: "Enter the code you received." };

  const supabase = await createServerSupabaseClient();

  // ── 6 digits: the fallback path, straight to Supabase ──────────
  if (code.length === 6) {
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  if (code.length !== 4) {
    return { ok: false, error: "The code is 4 digits." };
  }

  // Refuse before spending an attempt if this phone is still cooling
  // down from burning codes.
  const cooling = await cooldownRemaining(phone);
  if (cooling > 0) {
    return { ok: false, error: `Too many wrong codes. ${coolMsg(cooling)}`, cooldownMs: cooling, burned: true };
  }

  const res = await verifyShortCode(phone, code);
  if (!res.ok) {
    if (res.reason === "no_code") {
      return { ok: false, error: "No code waiting for this number. Send a new one." };
    }
    if (res.reason === "expired") {
      return { ok: false, error: "That code has expired. Send a new one." };
    }
    if (res.cooldownMs > 0) {
      return {
        ok: false,
        error: `That code is finished after ${MAX_ATTEMPTS} wrong tries. ${coolMsg(res.cooldownMs)}`,
        cooldownMs: res.cooldownMs,
        burned: true,
      };
    }
    return {
      ok: false,
      error: `Wrong code. ${res.attemptsLeft} ${res.attemptsLeft === 1 ? "try" : "tries"} left.`,
      attemptsLeft: res.attemptsLeft,
    };
  }

  // Short code was right — replay the real one so Supabase mints the
  // session and writes the cookies.
  const { error } = await supabase.auth.verifyOtp({ phone, token: res.realOtp, type: "sms" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
