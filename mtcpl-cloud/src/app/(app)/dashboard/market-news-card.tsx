// Owner market-news card (Daksh, June 2026). Server component — reads the
// latest stored brief + recent dates via the admin client (the daily_news
// table is service-role only) and hands plain data to the client panel.
// Rendered on the dashboard for owner/developer only (gated by the caller).
//
// The brief is generated 8 AM IST weekdays by Claude Sonnet 4.6 + web search
// (src/lib/market-news.ts) and refreshable on demand. Bilingual (EN + HI).

import { getLatestMarketNews } from "@/lib/market-news";
import { MarketNewsPanel } from "./market-news-panel";

export async function MarketNewsCard() {
  const { configured, news, dates } = await getLatestMarketNews();
  return <MarketNewsPanel configured={configured} news={news} dates={dates} />;
}
