// Owner daily market-news brief (Daksh, June 2026).
//
// Every weekday morning (8 AM IST, Vercel cron) we ask Claude Sonnet 4.6 —
// with the live web-search tool — to find the top global + Indian news that
// could move the Indian stock market today, and return a curated, BILINGUAL
// (English + Hindi) digest. The result is stored one-row-per-day in
// `daily_news` (history kept) and shown ONLY to the owner on the dashboard.
//
// The card also shows what each brief COST to generate (token + web-search
// spend), computed from the API usage. Pay-as-you-go on the Anthropic key
// (ANTHROPIC_API_KEY) — separate from MSG91.

import Anthropic from "@anthropic-ai/sdk";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// ── Pricing (USD per 1M tokens) — Claude Sonnet 4.6, + web search fee.
const SONNET_INPUT_PER_MTOK = 3;
const SONNET_OUTPUT_PER_MTOK = 15;
const WEB_SEARCH_PER_SEARCH = 0.01; // $10 / 1,000 searches
/** Approximate USD→INR for the on-screen ₹ figure (display only). */
export const USD_TO_INR = 86;

const MODEL = "claude-sonnet-4-6";

export type NewsItem = {
  category: string;
  icon: string;
  headline_en: string;
  headline_hi: string;
  summary_en: string;
  summary_hi: string;
  impact_en: string;
  impact_hi: string;
  source_name: string;
  source_url: string;
  sentiment: "positive" | "negative" | "neutral";
};

export type DailyNews = {
  newsDate: string; // YYYY-MM-DD (IST)
  generatedAt: string;
  model: string;
  items: NewsItem[];
  overviewEn: string | null;
  overviewHi: string | null;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
  trigger: string | null;
  error: string | null;
};

/** Today's date in IST (the market day the brief is for). */
function istDate(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function sanitizeItem(raw: unknown): NewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const headline_en = s("headline_en");
  if (!headline_en) return null;
  const sentiment = ["positive", "negative", "neutral"].includes(String(r.sentiment))
    ? (r.sentiment as NewsItem["sentiment"])
    : "neutral";
  return {
    category: s("category") || "News",
    icon: s("icon") || "📰",
    headline_en,
    headline_hi: s("headline_hi") || headline_en,
    summary_en: s("summary_en"),
    summary_hi: s("summary_hi"),
    impact_en: s("impact_en"),
    impact_hi: s("impact_hi"),
    source_name: s("source_name"),
    source_url: s("source_url"),
    sentiment,
  };
}

/** Pull the JSON object out of Claude's reply (tolerates ``` fences / stray prose). */
function extractJson(text: string): { overview_en?: string; overview_hi?: string; items?: unknown[] } {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

const SYSTEM_PROMPT = `You are a sharp financial-news analyst preparing a pre-market morning brief for the owner of an Indian company. He follows the Indian stock market (Nifty 50, Sensex). Your job each weekday morning, before Indian markets open, is to surface the news that actually matters for Indian equities TODAY — and to be selective, not exhaustive.

Use the web_search tool to gather CURRENT news from the last ~24 hours: overnight US/Asian/European market moves, crude oil, USD/INR, US Fed / RBI signals, FII/DII flows, big Indian corporate or policy news, global risk events, and anything likely to move the Nifty/Sensex at the open. Prefer reputable sources (Reuters, Bloomberg, Mint, Economic Times, Moneycontrol, CNBC, Business Standard).

Curate the TOP 8–10 items by likely market impact (most important first). For each item write BOTH a crisp English version AND a natural Hindi (Devanagari) version. Keep summaries to 1–2 sentences and the "impact" line to a short phrase on why it matters for the Indian market.`;

const USER_PROMPT = `Research this morning's market-moving news and return ONLY a JSON object (no prose, no markdown, no code fences) in exactly this shape:

{
  "overview_en": "one-line read on the likely market mood at the open",
  "overview_hi": "बाज़ार के मूड की एक पंक्ति",
  "items": [
    {
      "category": "Markets | Global | Oil | Currency | RBI/Policy | Commodities | Corporate | World",
      "icon": "a single relevant emoji",
      "headline_en": "short headline",
      "headline_hi": "छोटी हेडलाइन",
      "summary_en": "1–2 sentence summary",
      "summary_hi": "1–2 वाक्य का सारांश",
      "impact_en": "why it matters for the Indian market (short)",
      "impact_hi": "भारतीय बाज़ार पर असर (संक्षिप्त)",
      "source_name": "publication name",
      "source_url": "https://...",
      "sentiment": "positive | negative | neutral (for Indian equities)"
    }
  ]
}

Output the JSON object only.`;

/** Call Claude + web search, parse the digest, and compute the generation cost. */
export async function generateMarketNews(): Promise<Omit<DailyNews, "newsDate" | "generatedAt" | "trigger" | "error">> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment.");
  }
  const client = new Anthropic();

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Thinking off → all output tokens go to the JSON (reliable parse, lower cost);
    // the curation judgment comes from the prompt + search results.
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_PROMPT }],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 8, // hard cap on searches → bounds cost
        user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" },
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let overviewEn: string | null = null;
  let overviewHi: string | null = null;
  let items: NewsItem[] = [];
  try {
    const parsed = extractJson(text);
    overviewEn = typeof parsed.overview_en === "string" ? parsed.overview_en.trim() : null;
    overviewHi = typeof parsed.overview_hi === "string" ? parsed.overview_hi.trim() : null;
    items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(sanitizeItem)
      .filter((x): x is NewsItem => x !== null);
  } catch {
    throw new Error("Could not parse the news digest from the model response.");
  }
  if (items.length === 0) throw new Error("The model returned no news items.");

  const u = resp.usage;
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const outputTokens = u.output_tokens ?? 0;
  const webSearches =
    (u as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
  const costUsd =
    (inputTokens * SONNET_INPUT_PER_MTOK) / 1_000_000 +
    (outputTokens * SONNET_OUTPUT_PER_MTOK) / 1_000_000 +
    webSearches * WEB_SEARCH_PER_SEARCH;

  return {
    model: MODEL,
    items,
    overviewEn,
    overviewHi,
    inputTokens,
    outputTokens,
    webSearches,
    costUsd: Math.round(costUsd * 10000) / 10000,
  };
}

/** Generate today's brief and upsert it (one row per IST date). */
export async function generateAndStoreMarketNews(
  trigger: "cron" | "manual",
): Promise<{ ok: boolean; newsDate: string; count: number; costUsd: number; error?: string }> {
  const admin = createAdminSupabaseClient();
  const newsDate = istDate();
  try {
    const news = await generateMarketNews();
    const { error } = await admin.from("daily_news").upsert({
      news_date: newsDate,
      generated_at: new Date().toISOString(),
      model: news.model,
      items: news.items,
      overview_en: news.overviewEn,
      overview_hi: news.overviewHi,
      input_tokens: news.inputTokens,
      output_tokens: news.outputTokens,
      web_searches: news.webSearches,
      cost_usd: news.costUsd,
      trigger,
      error: null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, newsDate, count: news.items.length, costUsd: news.costUsd };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Record the failure (don't overwrite a good earlier run's items).
    await admin
      .from("daily_news")
      .upsert({ news_date: newsDate, generated_at: new Date().toISOString(), model: MODEL, trigger, error: msg }, { onConflict: "news_date", ignoreDuplicates: false })
      .then(() => undefined, () => undefined);
    return { ok: false, newsDate, count: 0, costUsd: 0, error: msg };
  }
}

function rowToDailyNews(d: Record<string, unknown>): DailyNews {
  return {
    newsDate: String(d.news_date),
    generatedAt: String(d.generated_at),
    model: String(d.model ?? MODEL),
    items: (Array.isArray(d.items) ? d.items : []) as NewsItem[],
    overviewEn: (d.overview_en as string | null) ?? null,
    overviewHi: (d.overview_hi as string | null) ?? null,
    inputTokens: Number(d.input_tokens) || 0,
    outputTokens: Number(d.output_tokens) || 0,
    webSearches: Number(d.web_searches) || 0,
    costUsd: Number(d.cost_usd) || 0,
    trigger: (d.trigger as string | null) ?? null,
    error: (d.error as string | null) ?? null,
  };
}

/** Latest stored brief (or null). Returns `configured: false` if the table is absent. */
export async function getLatestMarketNews(): Promise<{ configured: boolean; news: DailyNews | null; dates: string[] }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("daily_news")
    .select("*")
    .order("news_date", { ascending: false })
    .limit(30);
  if (error) return { configured: false, news: null, dates: [] };
  const rows = (data ?? []) as Record<string, unknown>[];
  const dates = rows.map((r) => String(r.news_date));
  const news = rows.length > 0 ? rowToDailyNews(rows[0]) : null;
  return { configured: true, news, dates };
}

/** One specific day's brief. */
export async function getMarketNewsByDate(date: string): Promise<DailyNews | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("daily_news").select("*").eq("news_date", date).maybeSingle();
  return data ? rowToDailyNews(data as Record<string, unknown>) : null;
}
