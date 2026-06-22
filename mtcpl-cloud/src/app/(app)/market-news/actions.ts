"use server";

// Owner/developer-only server actions for the Today's News page: browse a past
// day, and ask the market chat a question (Claude + web search).

import { requireAuth } from "@/lib/auth";
import { getMarketNewsByDate, askMarketQuestion, type DailyNews } from "@/lib/market-news";
import { canSeeMarketNews } from "@/lib/market-news-access";

async function ownerOnly(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return canSeeMarketNews(profile);
  } catch {
    return false;
  }
}

export async function getMarketNewsByDateAction(
  date: string,
): Promise<{ ok: true; news: DailyNews | null } | { ok: false; error: string }> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner / developer only." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Bad date." };
  return { ok: true, news: await getMarketNewsByDate(date) };
}

export async function askMarketQuestionAction(
  question: string,
  date: string,
  lang: "en" | "hi",
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner / developer only." };
  try {
    const news = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await getMarketNewsByDate(date) : null;
    const { answer } = await askMarketQuestion(question, lang === "hi" ? "hi" : "en", news);
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chat failed." };
  }
}
