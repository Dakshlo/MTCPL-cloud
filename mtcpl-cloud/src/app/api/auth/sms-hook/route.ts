// ──────────────────────────────────────────────────────────────────
// Supabase "Send SMS" auth hook  →  MSG91 delivery
// ──────────────────────────────────────────────────────────────────
//
// POST /api/auth/sms-hook
//
// Supabase calls this endpoint whenever it needs to send a phone OTP
// (login). Supabase generates AND verifies the code itself; we only
// carry the SMS to the user via MSG91's DLT-approved template. See
// src/lib/msg91.ts for the why/how.
//
// One-time wiring in the Supabase dashboard (owner):
//   Authentication → Hooks → "Send SMS hook" → enable, type HTTPS:
//     URL    = https://<app-domain>/api/auth/sms-hook
//     Secret = (Supabase generates it; copy into SEND_SMS_HOOK_SECRET)
//   Keep the Phone provider enabled — the hook overrides delivery, so
//   Twilio is no longer used once this is on.
//
// Security: the request is signed per the Standard Webhooks spec
// (the scheme Supabase auth hooks use). We verify the signature with
// SEND_SMS_HOOK_SECRET and FAIL CLOSED if it is missing or wrong —
// otherwise anyone hitting this URL could burn our MSG91 credits.
//
// Payload from Supabase:
//   { "user": { "phone": "919876543210", ... },
//     "sms":  { "otp": "123456" } }

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendOtpSms } from "@/lib/msg91";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify a Standard Webhooks signature. Returns true iff the HMAC of
 *  `${id}.${timestamp}.${body}` with the (base64-decoded) secret
 *  matches one of the signatures in the webhook-signature header. */
function verifySignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !sigHeader) return false;

  // Secret arrives as "v1,whsec_<base64>" (Supabase) — also accept a
  // bare "whsec_<base64>" or raw base64. Strip the scheme prefix to
  // recover the key bytes.
  const base64Secret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(base64Secret, "base64");
  } catch {
    return false;
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", keyBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header is a space-separated list of "v1,<sig>" pairs; any match is OK.
  for (const part of sigHeader.split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret) {
    console.error("[sms-hook] SEND_SMS_HOOK_SECRET not set — refusing to send.");
    return NextResponse.json(
      { error: { http_code: 500, message: "SMS hook not configured." } },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers, secret)) {
    console.error("[sms-hook] signature verification failed.");
    return NextResponse.json(
      { error: { http_code: 401, message: "Bad signature." } },
      { status: 401 },
    );
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { http_code: 400, message: "Bad payload." } },
      { status: 400 },
    );
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json(
      { error: { http_code: 400, message: "Missing phone or otp." } },
      { status: 400 },
    );
  }

  try {
    await sendOtpSms(phone, otp);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS send failed.";
    console.error("[sms-hook] MSG91 send failed:", message);
    // Standard Supabase hook error shape so the reason surfaces in the
    // dashboard logs / to the caller.
    return NextResponse.json({ error: { http_code: 502, message } }, { status: 200 });
  }

  // Empty 200 tells Supabase the SMS was dispatched successfully.
  return NextResponse.json({});
}
