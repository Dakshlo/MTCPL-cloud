// Carbon-copy for vendor WhatsApp messages — Daksh, June 2026.
//
// "Every time any message goes to a vendor, also send the same message to my
// number, so I see every vendor message but each vendor only gets their own."
// The CC number receives an identical 1:1 copy (separate WhatsApp message) —
// vendors never see the CC and never see each other.
//
// Stored in app_settings under the key 'wa_vendor_cc'
// (value: { enabled: boolean, number: string }). DEVELOPER-only toggle in
// Settings. Defaults to ON with the owner's number so the copy starts flowing
// the moment the voucher template is live.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { normalizeIndianMobile } from "@/lib/wa-send";

export const WA_VENDOR_CC_KEY = "wa_vendor_cc";
export const WA_VENDOR_CC_DEFAULT_NUMBER = "8003689760";

export type VendorCcSetting = { enabled: boolean; number: string };

const digits = (n: string) => String(n).replace(/\D/g, "");

/** The carbon-copy setting. Precedence: app_settings (UI) → default (ON,
 *  owner's number). Never throws — falls back to the default. */
export async function getVendorCcSetting(): Promise<VendorCcSetting> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_VENDOR_CC_KEY)
      .maybeSingle();
    const v = data?.value as { enabled?: unknown; number?: unknown } | null;
    if (v && typeof v.enabled === "boolean") {
      const num = digits(typeof v.number === "string" ? v.number : "");
      return { enabled: v.enabled, number: num || WA_VENDOR_CC_DEFAULT_NUMBER };
    }
  } catch {
    /* fall through to default */
  }
  return { enabled: true, number: WA_VENDOR_CC_DEFAULT_NUMBER };
}

/** The normalised CC recipient (e.g. "918003689760") if carbon-copy is ON,
 *  else null. Use this at any vendor-message send site so the copy logic
 *  stays in one place. */
export async function getVendorCcRecipient(): Promise<string | null> {
  const s = await getVendorCcSetting();
  if (!s.enabled) return null;
  return normalizeIndianMobile(s.number);
}

/** Persist the setting (auth/audit handled by the calling server action). */
export async function saveVendorCcSetting(
  next: { enabled: boolean; number: string },
  updatedBy: string,
): Promise<{ ok: true; value: VendorCcSetting } | { ok: false; error: string }> {
  const number = digits(next.number);
  if (next.enabled && (number.length < 10 || number.length > 12)) {
    return { ok: false, error: "Enter a valid 10-digit mobile number." };
  }
  const value: VendorCcSetting = {
    enabled: !!next.enabled,
    number: number || WA_VENDOR_CC_DEFAULT_NUMBER,
  };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_VENDOR_CC_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}
