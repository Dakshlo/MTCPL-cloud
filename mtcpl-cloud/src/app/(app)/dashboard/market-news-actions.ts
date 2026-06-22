"use server";

// Owner/developer-only reads for the dashboard market-news card: switch to a
// past day's brief. Generation itself runs through /api/market-news/generate
// (cron + manual POST).

import { requireAuth } from "@/lib/auth";
import { getMarketNewsByDate, type DailyNews } from "@/lib/market-news";

export async function getMarketNewsByDateAction(
  date: string,
): Promise<{ ok: true; news: DailyNews | null } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return { ok: false, error: "Owner / developer only." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Bad date." };
  const news = await getMarketNewsByDate(date);
  return { ok: true, news };
}
