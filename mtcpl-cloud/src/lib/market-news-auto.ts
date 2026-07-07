// Daily auto-generation toggle for "Today's News" (Daksh, Jul 2026).
//
// The Vercel cron (8 AM IST weekdays) only builds the brief when this is ON.
// Any owner can flip it from the Today's News page ("Daily auto" switch) to
// stop / resume the automatic morning brief. Manual "Generate now" ALWAYS
// works, regardless of this setting. Stored in app_settings under the key
// 'market_news_auto' (value: { enabled: boolean }); defaults to ON so the
// existing behaviour is preserved until someone turns it off.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const MARKET_NEWS_AUTO_KEY = "market_news_auto";

export type MarketNewsAutoSetting = { enabled: boolean };

/** Whether the daily cron should auto-generate. Precedence: app_settings (UI)
 *  → default ON. Never throws — falls back to the default. */
export async function getMarketNewsAuto(): Promise<MarketNewsAutoSetting> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", MARKET_NEWS_AUTO_KEY)
      .maybeSingle();
    const v = data?.value as { enabled?: unknown } | null;
    if (v && typeof v.enabled === "boolean") return { enabled: v.enabled };
  } catch {
    /* fall through to default */
  }
  return { enabled: true };
}

/** Persist the toggle (auth/audit handled by the calling server action). */
export async function saveMarketNewsAuto(
  enabled: boolean,
  updatedBy: string,
): Promise<{ ok: true; value: MarketNewsAutoSetting } | { ok: false; error: string }> {
  const value: MarketNewsAutoSetting = { enabled: !!enabled };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: MARKET_NEWS_AUTO_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}
