// ──────────────────────────────────────────────────────────────────
// IST date/time helpers.
//
// Every screen in this app thinks in Indian Standard Time, but the
// code runs on a UTC server (Vercel) and on IST laptops in dev. The
// pattern that had spread through the codebase to bridge that gap was
// subtly wrong:
//
//     const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
//
// It builds a STRING of the IST wall clock, then parses that string
// back as the RUNNING PROCESS's local time. Two things follow:
//
//   • Read it with .getDate() on a UTC server and you get the right
//     answer — by luck, because the wall clock you embedded is read
//     straight back out. On an IST laptop it is a day off.
//   • Format it with { timeZone: "Asia/Kolkata" } and the +5:30 is
//     applied a SECOND time. After 18:30 IST that lands on tomorrow.
//     This is what made the dashboard greet Daksh with "Friday, 28
//     August" at 23:14 on Thursday the 27th (Aug 2026).
//
// The fix is to stop round-tripping through a string. Intl formats an
// instant into a timezone directly and correctly, whatever the server
// clock is set to. Everything below is a thin wrapper over that.
// ──────────────────────────────────────────────────────────────────

const IST = "Asia/Kolkata";

/** Today in IST as `YYYY-MM-DD`. `daysAgo` steps whole days back —
 *  safe as plain arithmetic because IST has no daylight saving. */
export function istYmd(daysAgo = 0): string {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  // en-CA formats as YYYY-MM-DD, which is what we want to store/compare.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Hour of the day in IST, 0–23. For greetings and time-of-day gates. */
export function istHour(): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  // "24" appears at midnight in some ICU versions — normalise it.
  return Number(h) % 24;
}

/** "Thursday, 27 August 2026" — the dashboard hero's date line. */
export function istDateLabel(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
}

/** The IST day's boundaries as UTC ISO strings, for scoping queries. */
export function istDayRange(daysAgo = 0): { start: string; end: string; label: string } {
  const label = istYmd(daysAgo);
  return {
    start: new Date(`${label}T00:00:00+05:30`).toISOString(),
    end: new Date(`${label}T23:59:59.999+05:30`).toISOString(),
    label,
  };
}
