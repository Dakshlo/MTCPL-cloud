/**
 * Shared types + helpers for the DPR section grids (Block Added, Block
 * Cutted, …). Daksh, June 2026.
 *
 * Every section is a GROUP → ITEM table across four time windows:
 *   Daily = today · 7 Days = last 7 incl. today · Month = this calendar
 *   month · All Time = everything (all IST).
 * Each cell carries cft + tonnes + a count. The grid shows CFT (or TONNES
 * for tonnage stock like marble, which has no L×W×H) and flips to the count
 * on click.
 *
 * CFT = L×W×H ÷ 1728 (the *_ft columns hold INCHES — legacy naming).
 */

export type DprWin = { cft: number; tonnes: number; count: number };
export type DprWindows = { daily: DprWin; week: DprWin; month: DprWin; allTime: DprWin };
export type DprRow = { label: string; windows: DprWindows };
export type DprGroup = { label: string; windows: DprWindows; items: DprRow[] };
export type DprSection = { groups: DprGroup[]; total: DprWindows; generatedAt: string };

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** YYYY-MM-DD of an absolute instant, in IST. */
export function istKeyOf(ms: number): string {
  const d = new Date(ms + 5.5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** A date-key minus N days, still as a YYYY-MM-DD key (the ±5.5h cancels). */
export function keyMinusDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return istKeyOf(Date.UTC(y, m - 1, d) - days * 86_400_000 - 5.5 * 60 * 60 * 1000);
}

export type WinBounds = { todayKey: string; weekStartKey: string; curYm: string };
export function currentWindows(): WinBounds {
  const todayKey = istKeyOf(Date.now());
  return { todayKey, weekStartKey: keyMinusDays(todayKey, 6), curYm: todayKey.slice(0, 7) };
}
/** Which windows an event's timestamp falls into. */
export function windowFlags(iso: string | null | undefined, b: WinBounds) {
  const k = iso ? istKeyOf(new Date(iso).getTime()) : "";
  return {
    daily: k === b.todayKey,
    week: k >= b.weekStartKey && k <= b.todayKey,
    month: k.slice(0, 7) === b.curYm,
  };
}

export function emptyWin(): DprWin { return { cft: 0, tonnes: 0, count: 0 }; }
export function emptyWindows(): DprWindows {
  return { daily: emptyWin(), week: emptyWin(), month: emptyWin(), allTime: emptyWin() };
}
/** Fold one item (cft + tonnes, count+1) into every window it belongs to. */
export function addWin(
  win: DprWindows,
  v: { cft: number; tonnes: number },
  f: { daily: boolean; week: boolean; month: boolean },
): void {
  const apply = (w: DprWin) => { w.cft += v.cft; w.tonnes += v.tonnes; w.count += 1; };
  if (f.daily) apply(win.daily);
  if (f.week) apply(win.week);
  if (f.month) apply(win.month);
  apply(win.allTime);
}

/** Biggest first: all-time CFT, then tonnes, then count (so tonnage-only
 *  groups like marble still order sensibly instead of all tying at 0). */
export function byVolume(a: DprWindows, b: DprWindows): number {
  return (
    b.allTime.cft - a.allTime.cft ||
    b.allTime.tonnes - a.allTime.tonnes ||
    b.allTime.count - a.allTime.count
  );
}
