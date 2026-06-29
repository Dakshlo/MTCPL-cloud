/**
 * Shared types + helpers for the DPR section grids (Block Added, Block
 * Cutted, Carving Done, …). Daksh, June 2026.
 *
 * Each section is an ordered list of LINES — every line is a group (orange),
 * a subtotal (cyan), or an item (white) — rendered across four time windows:
 *   Daily = today · 7 Days = last 7 incl. today · Month = this calendar
 *   month · All Time = everything (all IST).
 * Each cell carries cft + tonnes + a count. The grid shows CFT (or TONNES
 * for tonnage stock like marble) and flips to the count on click.
 *
 * CFT = L×W×H ÷ 1728 (the *_ft columns hold INCHES — legacy naming).
 */

export type DprWin = { cft: number; tonnes: number; count: number };
export type DprWindows = { daily: DprWin; week: DprWin; month: DprWin; allTime: DprWin };

/** group = top level (stone / temple, orange) · subtotal = mid (CNC / Outsource
 *  total, cyan) · item = leaf (vendor, white). */
export type DprTone = "group" | "subtotal" | "item";
export type DprLine = { tone: DprTone; label: string; windows: DprWindows };
/** One temple's slice of a section — its sub-rows (stones / vendors) WITHOUT the
 *  temple group header, plus its total. Drives the per-temple Site-wise view. */
export type TempleSlice = { temple: string; total: DprWindows; lines: DprLine[] };
export type DprSection = { lines: DprLine[]; total: DprWindows; byTemple?: TempleSlice[]; generatedAt: string };

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

// ── shared temple → CNC/Outsource → vendor builder ──────────────────────
// Used by Block Cutted and Carving Done — both group TEMPLE-wise, then split
// by carving vendor type (CNC vs Outsource), then by vendor. Block Cutted may
// also carry slabs not yet assigned to any carver → a "NOT ASSIGNED" item.

export type VendorItem = {
  temple: string | null;
  cft: number;
  /** the window date (cut-done date, or carving-done date) */
  date: string | null;
  /** "CNC" | "Outsource" | null (not yet assigned to a carver) */
  vendorType: "CNC" | "Outsource" | null;
  vendorName: string | null;
};

type TempleAgg = {
  windows: DprWindows;
  cnc: { sum: DprWindows; vendors: Map<string, DprWindows> };
  out: { sum: DprWindows; vendors: Map<string, DprWindows> };
  unassigned: DprWindows;
  hasUnassigned: boolean;
};
function newTempleAgg(): TempleAgg {
  return {
    windows: emptyWindows(),
    cnc: { sum: emptyWindows(), vendors: new Map() },
    out: { sum: emptyWindows(), vendors: new Map() },
    unassigned: emptyWindows(),
    hasUnassigned: false,
  };
}
function vendorLines(vendors: Map<string, DprWindows>): DprLine[] {
  return [...vendors.entries()]
    .map(([label, windows]) => ({ tone: "item" as const, label, windows }))
    .sort((a, b) => byVolume(a.windows, b.windows) || a.label.localeCompare(b.label));
}

// ── shared temple → STONE builder ───────────────────────────────────────
// Block Cutted + Dispatched group TEMPLE-wise, then by STONE under each temple
// (Daksh — block cutted is the cut slabs per site per stone, NOT per carver).
export type StoneItem = { temple: string | null; stone: string | null; cft: number; date: string | null };

export function buildTempleStoneSection(
  items: StoneItem[],
  bounds: WinBounds,
): { lines: DprLine[]; total: DprWindows; byTemple: TempleSlice[] } {
  const temples = new Map<string, { windows: DprWindows; stones: Map<string, DprWindows> }>();
  const total = emptyWindows();
  for (const it of items) {
    const temple = (it.temple ?? "").trim() || "—";
    const stone = (it.stone ?? "").trim() || "—";
    const v = { cft: it.cft, tonnes: 0 };
    const f = windowFlags(it.date, bounds);
    let t = temples.get(temple);
    if (!t) { t = { windows: emptyWindows(), stones: new Map() }; temples.set(temple, t); }
    addWin(t.windows, v, f);
    addWin(total, v, f);
    let sw = t.stones.get(stone);
    if (!sw) { sw = emptyWindows(); t.stones.set(stone, sw); }
    addWin(sw, v, f);
  }
  const lines: DprLine[] = [];
  const byTemple: TempleSlice[] = [];
  const sorted = [...temples.entries()].sort((a, b) => byVolume(a[1].windows, b[1].windows) || a[0].localeCompare(b[0]));
  for (const [temple, t] of sorted) {
    lines.push({ tone: "group", label: temple, windows: t.windows });
    const stoneLines: DprLine[] = [...t.stones.entries()]
      .sort((a, b) => byVolume(a[1], b[1]) || a[0].localeCompare(b[0]))
      .map(([stone, sw]) => ({ tone: "item" as const, label: stone, windows: sw }));
    lines.push(...stoneLines);
    byTemple.push({ temple, total: t.windows, lines: stoneLines });
  }
  return { lines, total, byTemple };
}

export function buildTempleVendorSection(
  items: VendorItem[],
  bounds: WinBounds,
): { lines: DprLine[]; total: DprWindows; byTemple: TempleSlice[] } {
  const temples = new Map<string, TempleAgg>();
  const total = emptyWindows();

  for (const it of items) {
    const temple = (it.temple ?? "").trim() || "—";
    const v = { cft: it.cft, tonnes: 0 };
    const f = windowFlags(it.date, bounds);
    let t = temples.get(temple);
    if (!t) { t = newTempleAgg(); temples.set(temple, t); }
    addWin(t.windows, v, f);
    addWin(total, v, f);

    if (it.vendorType === "CNC" || it.vendorType === "Outsource") {
      const side = it.vendorType === "CNC" ? t.cnc : t.out;
      addWin(side.sum, v, f);
      const vn = (it.vendorName ?? "").trim() || "—";
      let vw = side.vendors.get(vn);
      if (!vw) { vw = emptyWindows(); side.vendors.set(vn, vw); }
      addWin(vw, v, f);
    } else {
      addWin(t.unassigned, v, f);
      t.hasUnassigned = true;
    }
  }

  const lines: DprLine[] = [];
  const byTemple: TempleSlice[] = [];
  const sorted = [...temples.entries()].sort(
    (a, b) => byVolume(a[1].windows, b[1].windows) || a[0].localeCompare(b[0]),
  );
  for (const [temple, t] of sorted) {
    const sub: DprLine[] = [];
    if (t.cnc.vendors.size > 0) {
      sub.push({ tone: "subtotal", label: "CNC VENDOR TOTAL", windows: t.cnc.sum });
      sub.push(...vendorLines(t.cnc.vendors));
    }
    if (t.out.vendors.size > 0) {
      sub.push({ tone: "subtotal", label: "OUTSOURCE TOTAL", windows: t.out.sum });
      sub.push(...vendorLines(t.out.vendors));
    }
    if (t.hasUnassigned) {
      sub.push({ tone: "item", label: "NOT ASSIGNED TO CARVING", windows: t.unassigned });
    }
    lines.push({ tone: "group", label: temple, windows: t.windows });
    lines.push(...sub);
    byTemple.push({ temple, total: t.windows, lines: sub });
  }
  return { lines, total, byTemple };
}
