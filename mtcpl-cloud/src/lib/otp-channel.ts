// ──────────────────────────────────────────────────────────────────
// Which channel should this login OTP go out on?
//
// Daksh (Aug 2026): "don't remove SMS — we will use 2 buttons, SMS and
// WhatsApp, user can get whatever they want."
//
// The awkward bit: Supabase GENERATES the OTP and then calls our Send
// SMS hook server-to-server. That payload carries the phone and the
// code — and nothing about which button the person pressed. So the
// browser records the choice here first (a server action, pre-login,
// unauthenticated by necessity), and the hook reads it back.
//
// Storage is ONE app_settings row holding a small phone -> choice map,
// pruned on every write, so there's no migration and nothing to clean
// up later. Entries live 10 minutes — far longer than the seconds
// between pressing the button and Supabase calling the hook, far
// shorter than anything worth persisting.
//
// EVERY failure path returns "sms". A lost preference means the person
// gets a text instead of a WhatsApp — mildly annoying. The reverse
// (defaulting to a channel that might not reach them) locks them out
// of the app.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type OtpChannel = "sms" | "whatsapp";

const KEY = "otp_channel_recent";
const TTL_MS = 10 * 60 * 1000;
/** Hard cap so a script hammering the pre-login action can't grow the
 *  row without bound. Oldest entries fall off first. */
const MAX_ENTRIES = 200;

type Entry = { c: OtpChannel; at: number };
type Store = Record<string, Entry>;

function prune(store: Store): Store {
  const cutoff = Date.now() - TTL_MS;
  const fresh = Object.entries(store).filter(([, v]) => v && v.at > cutoff);
  fresh.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(fresh.slice(0, MAX_ENTRIES));
}

/** Record the channel the person chose, keyed by the phone Supabase
 *  will hand back to the hook. Never throws — a failure here must not
 *  block the login. */
export async function rememberOtpChannel(phone: string, channel: OtpChannel): Promise<void> {
  const key = (phone || "").replace(/\D/g, "");
  if (!key) return;
  try {
    const admin = createAdminSupabaseClient();
    const { data: row } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const store: Store =
      row?.value && typeof row.value === "object" ? (row.value as Store) : {};
    const next = prune({ ...store, [key]: { c: channel, at: Date.now() } });
    await admin.from("app_settings").upsert({
      key: KEY,
      value: next,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[otp-channel] could not record choice:", err);
  }
}

/** Read the channel for a phone. Defaults to "sms" on absence, expiry,
 *  or any error at all. */
export async function readOtpChannel(phone: string): Promise<OtpChannel> {
  const key = (phone || "").replace(/\D/g, "");
  if (!key) return "sms";
  try {
    const admin = createAdminSupabaseClient();
    const { data: row } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const store: Store =
      row?.value && typeof row.value === "object" ? (row.value as Store) : {};
    const hit = store[key];
    if (!hit || hit.at < Date.now() - TTL_MS) return "sms";
    return hit.c === "whatsapp" ? "whatsapp" : "sms";
  } catch (err) {
    console.error("[otp-channel] could not read choice, defaulting to SMS:", err);
    return "sms";
  }
}
