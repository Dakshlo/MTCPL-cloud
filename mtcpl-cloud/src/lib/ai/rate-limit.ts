/**
 * Per-user daily rate limit for the Ask AI endpoint.
 *
 * Counter lives in-memory (process-local) and resets at IST midnight. A
 * Vercel cold start also resets it, which means the real-world cap is
 * "soft" — but with a daily ceiling of 50 per user and an expected load of
 * ~10 queries/day, that's more than enough to stop a runaway script
 * (accidental fetch loop, abusive client). For a durable per-user budget
 * we'd move this to a Supabase table; not worth it yet.
 */

const DAILY_CAP = 50;
const counters = new Map<string, { date: string; count: number }>();

function istTodayLabel(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function checkAndIncrement(userId: string): { ok: true; remaining: number } | { ok: false; resetAt: string } {
  const today = istTodayLabel();
  const entry = counters.get(userId);

  if (!entry || entry.date !== today) {
    counters.set(userId, { date: today, count: 1 });
    return { ok: true, remaining: DAILY_CAP - 1 };
  }

  if (entry.count >= DAILY_CAP) {
    return { ok: false, resetAt: "next IST midnight" };
  }

  entry.count++;
  return { ok: true, remaining: DAILY_CAP - entry.count };
}

/** Read the current count for a user without incrementing. For debug / UI. */
export function getUsage(userId: string): { count: number; cap: number } {
  const today = istTodayLabel();
  const entry = counters.get(userId);
  if (!entry || entry.date !== today) return { count: 0, cap: DAILY_CAP };
  return { count: entry.count, cap: DAILY_CAP };
}
