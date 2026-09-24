/**
 * Shared window rules for the two Various Costing reports (CNC and
 * Cutter). Both pages compute the same two things and used to do it
 * twice each, slightly differently.
 *
 * ── Why the year does not start in January ──────────────────────
 *
 * Daksh, Sep 2026: "in CNC and cutter costing in yearly, for only this
 * year it currently considers from start of 2026 to current date. But
 * the software completely started properly at the start of June, so you
 * need to not count the ~150 starting days — only this year, not next."
 *
 * The first five months of 2026 carry expenses but almost no recorded
 * output, because the plant was still being moved onto the software.
 * Dividing a full year of cost by five months of missing production
 * made the yearly ₹/unit look far worse than the floor actually is, and
 * the yearly daily average was being spread over days nobody was
 * entering anything.
 *
 * So the 2026 window starts on 1 June 2026 — the day the data becomes
 * trustworthy. Every later year runs January to December as normal; this
 * is a one-off correction for the year the software came up, not a
 * permanent financial-year rule. Change COSTING_DATA_START and the rule
 * moves with it; delete nothing else.
 *
 * Only the YEARLY window is clamped. Picking May 2026 in the monthly
 * view still shows May exactly as it was recorded — this hides nothing,
 * it only stops the part-year from being averaged into the year.
 */

/** The first day whose numbers are complete enough to average over. */
export const COSTING_DATA_START = "2026-06-01";

const COSTING_DATA_START_YEAR = Number(COSTING_DATA_START.slice(0, 4));

/** Where a yearly window begins: 1 January, except in the year the
 *  software came up, which begins on COSTING_DATA_START. */
export function yearlyWindowStart(year: number): string {
  return year === COSTING_DATA_START_YEAR ? COSTING_DATA_START : `${year}-01-01`;
}

/** True when this year's window is the clipped one — the pages use it
 *  to say so on screen rather than quietly showing a short year. */
export function isClippedYear(year: number): boolean {
  return year === COSTING_DATA_START_YEAR;
}

/** Today in IST as YYYY-MM-DD. */
export function istDateKey(at: number = Date.now()): string {
  const d = new Date(at + 5.5 * 60 * 60 * 1000);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Whole days in a window, clamped to today.
 *
 * An unfinished period must divide by the days that have actually
 * happened, not by the calendar span — otherwise every current month,
 * week and year reads low simply because it is not over yet. A window
 * that has not started returns null, so the caller can leave the tile
 * off instead of dividing by a day nobody worked.
 */
export function daysElapsedInWindow(startDate: string, endDate: string): number | null {
  const today = istDateKey();
  if (startDate > today) return null;
  const end = endDate < today ? endDate : today;
  const ms = (s: string) =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const days = Math.floor((ms(end) - ms(startDate)) / 86_400_000) + 1;
  return days > 0 ? days : null;
}
