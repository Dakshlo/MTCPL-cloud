/**
 * Tender / Price-Breakdown shared model (Daksh, Aug 2026). Plain module —
 * imported by the server action, the page loader, the QUOTATION PRINT page
 * AND the client workspace, so it must carry no server-only or client-only
 * code. The maths lives here too, so the on-screen sheet, the printed
 * quotation and the version diff can never disagree.
 */

export type TenderItemMode = "amount" | "per_cft" | "percent";

export type TenderItem = {
  id: string;
  title: string;
  mode: TenderItemMode;
  /** ₹ for amount, ₹/unit for per_cft, 0-100 for percent. */
  value: number;
};

export type TenderGroup = {
  id: string;
  title: string;
  items: TenderItem[];
};

/** Billing unit of the sheet. The company quotes carving in Cft. and slab
 *  work in Sqft.; the label rides through every rate row and the total. */
export type TenderUom = "Cft." | "Sqft." | "Nos." | "Kg." | "Rmt.";
export const TENDER_UOMS: TenderUom[] = ["Cft.", "Sqft.", "Nos.", "Kg.", "Rmt."];

/** The covering letter around the rate table — everything the printed
 *  quotation needs that the costing sheet itself doesn't care about. */
export type TenderQuote = {
  /** "Mr. Shubham Patil" */
  toName: string;
  /** "Shree Ram Mandir, AVP'S SRIMS" — one per line on the letter. */
  toOrg: string;
  /** "Aurangabad (MH)" */
  toPlace: string;
  /** Table caption: "Rate Breakup for <work>". */
  work: string;
  /** Free paragraph under the salutation. Blank → a sensible default. */
  intro: string;
  /** Numbered terms, one per line. */
  terms: string;
  /** Letter date, yyyy-mm-dd. Blank → today at print time. */
  date: string;
  /** Optional our-ref line printed beside the date. */
  refNo: string;
};

export function blankQuote(): TenderQuote {
  return { toName: "", toOrg: "", toPlace: "", work: "", intro: "", terms: "", date: "", refNo: "" };
}

/** A frozen copy of the sheet's numbers, taken when the team says "this is
 *  the version we sent". Re-pricing then has something to be compared to. */
export type TenderVersion = {
  id: string;
  /** "v1 — sent to Shubham" */
  label: string;
  savedAt: string;
  qty: number | null;
  groups: TenderGroup[];
  /** Snapshot of the total at save time (so the list reads without recompute). */
  grand: number;
};

export type TenderAnalysis = {
  id: string;
  name: string;
  /** Project quantity in the sheet's unit — powers ₹/unit rows + the per-unit
   *  total. null = lump-sum sheet (per_cft rows then contribute 0). */
  qty: number | null;
  /** Production pace override, CFT/day. null = use the live pace the
   *  page derives from the P&L window's actual cutting. */
  paceCftPerDay: number | null;
  /** Hard manual timeline, days. null = derive from qty ÷ pace. */
  manualDays: number | null;
  groups: TenderGroup[];
  createdAt: string;
  updatedAt: string;
  /** Sheet unit. Absent on pre-Aug-2026 sheets → "Cft.". */
  uom?: TenderUom;
  /** Covering-letter fields for the printed quotation. */
  quote?: TenderQuote;
  /** Saved snapshots, newest first. */
  versions?: TenderVersion[];
};

/** app_settings key holding every sheet. */
export const TENDER_KEY = "tender_analyses";

export const uomOf = (a: { uom?: TenderUom }): TenderUom => a.uom ?? "Cft.";
/** "Cft." → "CFT" for the compact on-screen chips. */
export const uomShort = (u: TenderUom): string => u.replace(/\.$/, "").toUpperCase();

// ── maths (shared by the workspace, the print page and the diff) ───────────

/** One item's ₹ contribution. % items resolve against the ₹ subtotal. */
export function itemRupees(it: TenderItem, qty: number | null, base: number): number {
  if (it.mode === "amount") return it.value;
  if (it.mode === "per_cft") return it.value * (qty ?? 0);
  return (it.value / 100) * base;
}

export type SheetGroupCalc = { id: string; title: string; total: number; color: string };
export type SheetCalc = {
  base: number;
  pctAdd: number;
  grand: number;
  groups: SheetGroupCalc[];
  /** grand ÷ qty — the "Total Rate Per Cft." the quotation leads with. */
  perCft: number | null;
};

/** Group accent colours, cycled — donut, bars and header dots share them. */
export const GROUP_COLORS = ["#4f46e5", "#c2740a", "#0284c7", "#0f9d58", "#7c3aed", "#e11d48", "#0d9488", "#64748b"];

/** Sheet economics: base = Σ ₹ items (amount + per_cft); % rows ride on it. */
export function computeSheet(a: { qty: number | null; groups: TenderGroup[] }): SheetCalc {
  let base = 0;
  for (const g of a.groups) for (const it of g.items) {
    if (it.mode === "amount") base += it.value;
    else if (it.mode === "per_cft") base += it.value * (a.qty ?? 0);
  }
  const groups = a.groups.map((g, i) => ({
    id: g.id,
    title: g.title || "Untitled",
    total: g.items.reduce((s, it) => s + itemRupees(it, a.qty, base), 0),
    color: GROUP_COLORS[i % GROUP_COLORS.length],
  }));
  const pctAdd = groups.reduce((s, g) => s + g.total, 0) - base;
  const grand = base + pctAdd;
  return { base, pctAdd, grand, groups, perCft: a.qty && a.qty > 0 ? grand / a.qty : null };
}

/** The per-unit rate ONE line contributes — the number the quotation prints.
 *  A lump-sum (₹ fixed) line spreads over the quantity; a % line spreads its
 *  share of the subtotal. Returns null when there's no quantity to divide by. */
export function itemPerUnit(it: TenderItem, qty: number | null, base: number): number | null {
  if (it.mode === "per_cft") return it.value;
  if (!qty || qty <= 0) return null;
  return itemRupees(it, qty, base) / qty;
}

export type QuoteRow = { sr: number; particulars: string; rate: number | null; amount: number; group: string };

/** Flatten a sheet into the quotation's Sr. / Particulars / Rate rows —
 *  every named line, in sheet order, with its per-unit rate. */
export function quoteRows(a: { qty: number | null; groups: TenderGroup[] }): QuoteRow[] {
  const { base } = computeSheet(a);
  const out: QuoteRow[] = [];
  for (const g of a.groups) {
    for (const it of g.items) {
      const title = (it.title || "").trim();
      const amount = itemRupees(it, a.qty, base);
      if (!title && amount <= 0) continue; // never print an empty scratch row
      out.push({
        sr: out.length + 1,
        particulars: title || "—",
        rate: itemPerUnit(it, a.qty, base),
        amount,
        group: g.title || "",
      });
    }
  }
  return out;
}

// ── version diff ──────────────────────────────────────────────────────────

export type DiffLine = {
  key: string;
  group: string;
  title: string;
  status: "same" | "changed" | "added" | "removed";
  /** Per-unit rate then / now (null when the sheet had no quantity). */
  oldRate: number | null;
  newRate: number | null;
  oldAmount: number;
  newAmount: number;
  delta: number;
};

export type SheetDiff = {
  oldGrand: number;
  newGrand: number;
  oldPerCft: number | null;
  newPerCft: number | null;
  oldQty: number | null;
  newQty: number | null;
  delta: number;
  deltaPct: number | null;
  lines: DiffLine[];
  /** Per-group movement, biggest mover first. */
  groups: Array<{ title: string; oldTotal: number; newTotal: number; delta: number }>;
  changedCount: number;
};

type Side = { qty: number | null; groups: TenderGroup[] };

/** What changed between two snapshots of the SAME sheet. Lines are matched on
 *  their item id (stable across versions); a line whose id is gone counts as
 *  removed and its replacement as added, which is exactly how a re-priced
 *  sheet should read. */
export function diffSheets(prev: Side, next: Side): SheetDiff {
  const a = computeSheet(prev);
  const b = computeSheet(next);

  type Ref = { group: string; title: string; rate: number | null; amount: number };
  const index = (side: Side, calc: SheetCalc) => {
    const m = new Map<string, Ref>();
    for (const g of side.groups) {
      for (const it of g.items) {
        if (!(it.title || "").trim() && itemRupees(it, side.qty, calc.base) <= 0) continue;
        m.set(it.id, {
          group: g.title || "Untitled",
          title: (it.title || "").trim() || "—",
          rate: itemPerUnit(it, side.qty, calc.base),
          amount: itemRupees(it, side.qty, calc.base),
        });
      }
    }
    return m;
  };
  const A = index(prev, a);
  const B = index(next, b);

  const lines: DiffLine[] = [];
  const seen = new Set<string>();
  for (const [id, nb] of B) {
    seen.add(id);
    const na = A.get(id);
    if (!na) {
      lines.push({ key: id, group: nb.group, title: nb.title, status: "added", oldRate: null, newRate: nb.rate, oldAmount: 0, newAmount: nb.amount, delta: nb.amount });
      continue;
    }
    const moved = Math.abs(nb.amount - na.amount) > 0.5 || (na.rate ?? -1) !== (nb.rate ?? -1) || na.title !== nb.title;
    lines.push({
      key: id, group: nb.group, title: nb.title,
      status: moved ? "changed" : "same",
      oldRate: na.rate, newRate: nb.rate,
      oldAmount: na.amount, newAmount: nb.amount,
      delta: nb.amount - na.amount,
    });
  }
  for (const [id, na] of A) {
    if (seen.has(id)) continue;
    lines.push({ key: id, group: na.group, title: na.title, status: "removed", oldRate: na.rate, newRate: null, oldAmount: na.amount, newAmount: 0, delta: -na.amount });
  }
  // Movers first, then the untouched lines in sheet order.
  lines.sort((x, y) => (x.status === "same" ? 1 : 0) - (y.status === "same" ? 1 : 0) || Math.abs(y.delta) - Math.abs(x.delta));

  const gmap = new Map<string, { title: string; oldTotal: number; newTotal: number }>();
  for (const g of a.groups) gmap.set(g.title, { title: g.title, oldTotal: g.total, newTotal: 0 });
  for (const g of b.groups) {
    const e = gmap.get(g.title) ?? { title: g.title, oldTotal: 0, newTotal: 0 };
    e.newTotal = g.total;
    gmap.set(g.title, e);
  }
  const groups = [...gmap.values()]
    .map((g) => ({ ...g, delta: g.newTotal - g.oldTotal }))
    .filter((g) => g.oldTotal > 0 || g.newTotal > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    oldGrand: a.grand, newGrand: b.grand,
    oldPerCft: a.perCft, newPerCft: b.perCft,
    oldQty: prev.qty, newQty: next.qty,
    delta: b.grand - a.grand,
    deltaPct: a.grand > 0 ? ((b.grand - a.grand) / a.grand) * 100 : null,
    lines,
    groups,
    changedCount: lines.filter((l) => l.status !== "same").length,
  };
}
