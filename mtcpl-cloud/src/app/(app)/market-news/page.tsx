// Owner-only "Today's News" page — a dedicated, liquid-glass market brief
// with a bull/bear verdict, the day's curated news, and a market chat box.
// Reached from the dashboard hero card. Generated 8 AM IST weekdays by
// Claude Sonnet 4.6 + web search (src/lib/market-news.ts).

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getLatestMarketNews } from "@/lib/market-news";
import { getMarketNewsAuto } from "@/lib/market-news-auto";
import { canSeeMarketNews } from "@/lib/market-news-access";
import { MarketNewsView } from "./market-news-view";

export const dynamic = "force-dynamic";

export default async function MarketNewsPage() {
  const { profile } = await requireAuth();
  // Every owner + the developer.
  if (!canSeeMarketNews(profile)) redirect("/dashboard");
  const [{ configured, news, dates }, auto] = await Promise.all([
    getLatestMarketNews(),
    getMarketNewsAuto(),
  ]);
  return <MarketNewsView configured={configured} news={news} dates={dates} autoOn={auto.enabled} />;
}
