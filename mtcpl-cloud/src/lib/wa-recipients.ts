// Daily WhatsApp work-report recipients — managed from Settings (owner/dev)
// and stored in app_settings under the key 'wa_report_recipients'
// (value: { numbers: string[] } of 10-digit Indian mobiles). Falls back to
// the MSG91_WA_REPORT_TO env var, then a hard-coded default, so the report
// keeps working before anyone touches the UI.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const WA_REPORT_SETTINGS_KEY = "wa_report_recipients";
export const WA_REPORT_DEFAULT_RECIPIENTS = ["8003689760", "9414152740"];

const digits = (n: string) => String(n).replace(/\D/g, "");

/** The effective recipient list as RAW digit strings (10-digit), for the UI
 *  and the sender. Precedence: app_settings (UI) → env → default. */
export async function getReportRecipientNumbers(): Promise<string[]> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_REPORT_SETTINGS_KEY)
      .maybeSingle();
    const nums = (data?.value as { numbers?: unknown } | null)?.numbers;
    if (Array.isArray(nums)) {
      const clean = nums.map(digits).filter(Boolean);
      if (clean.length > 0) return clean;
    }
  } catch { /* fall through to env / default */ }
  const raw = process.env.MSG91_WA_REPORT_TO;
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : WA_REPORT_DEFAULT_RECIPIENTS;
  return list.map(digits).filter(Boolean);
}

/** Persist the full recipient list (raw upsert — auth/audit handled by the
 *  calling server action). Numbers are cleaned + deduped here. */
export async function saveReportRecipientNumbers(numbers: string[], updatedBy: string): Promise<{ ok: true; numbers: string[] } | { ok: false; error: string }> {
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(digits).filter((n) => n.length >= 10 && n.length <= 12))];
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_REPORT_SETTINGS_KEY,
    value: { numbers: clean },
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, numbers: clean };
}
