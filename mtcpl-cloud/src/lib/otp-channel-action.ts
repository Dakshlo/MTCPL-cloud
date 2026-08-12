"use server";

/**
 * Pre-login server action: record which button the person pressed
 * (SMS or WhatsApp) so the Supabase Send-SMS hook can route the code.
 *
 * This runs BEFORE anyone is signed in, so it cannot be auth-gated —
 * that's inherent to a login screen. It's deliberately the least
 * powerful thing that works:
 *   • it stores a channel preference and NOTHING else;
 *   • it cannot send a message, mint a code, or read a user;
 *   • an unknown/garbage phone just writes a row nobody reads, and the
 *     store self-prunes to 200 entries / 10 minutes;
 *   • worst case for an abuser is making someone receive a text
 *     instead of a WhatsApp.
 *
 * Whether an OTP is actually sent is still entirely Supabase's call —
 * this only decides the pipe it travels down.
 */

import { rememberOtpChannel, type OtpChannel } from "@/lib/otp-channel";

export async function setOtpChannelAction(
  phone: string,
  channel: OtpChannel,
): Promise<void> {
  if (channel !== "sms" && channel !== "whatsapp") return;
  const digits = String(phone ?? "").replace(/\D/g, "");
  // 10-digit Indian mobile, or already country-coded.
  if (digits.length < 10 || digits.length > 12) return;
  await rememberOtpChannel(digits, channel);
}
