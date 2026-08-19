/**
 * Tender / Price-Breakdown shared model (Daksh, Aug 2026). Plain module —
 * imported by the server action, the page loader, the QUOTATION PRINT page
 * AND the client workspace, so it must carry no server-only or client-only
 * code. The maths lives here too, so the on-screen sheet, the printed
 * quotation and the version diff can never disagree.
 *
 * THREE LEVELS (Aug 2026). The paper quotation carries more than one rate
 * breakup — "Rate Breakup for Sandstone Carving Work" in Cft., then "Rate
 * Breakup for Marble Slab" in Sqft. — each with its OWN quantity, unit and
 * "Total Rate Per …". So a sheet is:
 *
 *     sheet  →  section (master group: a material / scope, its own qty+unit)
 *            →  group   (cost head: carving, transport, joining materials…)
 *            →  item    (line: ₹ fixed · ₹/unit · % of that section's ₹)
 *
 * % lines resolve against THEIR OWN section's subtotal — each section is a
 * self-contained rate breakup, exactly as it prints.
 *
 * Pre-section sheets stored `groups` + `qty` + `uom` at the top level.
 * `sectionsOf()` lifts those into a single unnamed section, so nothing has to
 * be migrated and an old sheet computes byte-identically.
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

/** Billing unit. The company quotes carving in Cft. and slab work in Sqft.;
 *  the label rides through every rate row and the section total. */
export type TenderUom = "Cft." | "Sqft." | "Nos." | "Kg." | "Rmt.";
export const TENDER_UOMS: TenderUom[] = ["Cft.", "Sqft.", "Nos.", "Kg.", "Rmt."];

/** A MASTER GROUP — one whole rate breakup inside the quotation. */
export type TenderSection = {
  id: string;
  /** "Sandstone Carving Work" / "Marble Slab". Blank on a lifted legacy sheet. */
  title: string;
  uom: TenderUom;
  /** This section's project quantity, in its own unit. */
  qty: number | null;
  groups: TenderGroup[];
};

/** The covering letter around the rate tables — everything the printed
 *  quotation needs that the costing sheet itself doesn't care about. */
export type TenderQuote = {
  /** "Mr. Shubham Patil" */
  toName: string;
  /** "Shree Ram Mandir, AVP'S SRIMS" */
  toOrg: string;
  /** "Aurangabad (MH)" */
  toPlace: string;
  /** Fallback table caption when a section has no name of its own. */
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
  /** Legacy single-section snapshot fields (pre-Aug-2026 versions). */
  qty: number | null;
  groups: TenderGroup[];
  /** Snapshot of every section. Absent on a legacy version → lifted from above. */
  sections?: TenderSection[];
  /** Snapshot of the total at save time (so the list reads without recompute). */
  grand: number;
};

export type TenderAnalysis = {
  id: string;
  name: string;
  /** LEGACY single-section quantity. Mirrors sections[0] on a live sheet. */
  qty: number | null;
  /** Production pace override, CFT/day. null = use the live pace the
   *  page derives from the P&L window's actual cutting. */
  paceCftPerDay: number | null;
  /** Hard manual timeline, days. null = derive from qty ÷ pace. */
  manualDays: number | null;
  /** LEGACY single-section groups. Mirrors sections[0] on a live sheet. */
  groups: TenderGroup[];
  createdAt: string;
  updatedAt: string;
  /** LEGACY single-section unit. Mirrors sections[0] on a live sheet. */
  uom?: TenderUom;
  /** The master groups. Absent on a pre-Aug-2026 sheet → lifted from the
   *  legacy fields by sectionsOf(). */
  sections?: TenderSection[];
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

/** Every sheet, old or new, read as sections. THE accessor — nothing should
 *  touch `.groups` / `.qty` directly. */
export function sectionsOf(a: {
  sections?: TenderSection[];
  groups?: TenderGroup[];
  qty?: number | null;
  uom?: TenderUom;
}): TenderSection[] {
  if (Array.isArray(a.sections) && a.sections.length > 0) return a.sections;
  return [{ id: "s0", title: "", uom: uomOf(a), qty: a.qty ?? null, groups: a.groups ?? [] }];
}

export function blankSection(uom: TenderUom = "Cft."): TenderSection {
  return { id: "", title: "", uom, qty: null, groups: [] };
}

// ── maths (shared by the workspace, the print page and the diff) ───────────

/** One item's ₹ contribution. % items resolve against their section's subtotal. */
export function itemRupees(it: TenderItem, qty: number | null, base: number): number {
  if (it.mode === "amount") return it.value;
  if (it.mode === "per_cft") return it.value * (qty ?? 0);
  return (it.value / 100) * base;
}

export type SheetGroupCalc = { id: string; title: string; total: number; color: string };
export type SectionCalc = {
  base: number;
  pctAdd: number;
  grand: number;
  groups: SheetGroupCalc[];
  /** grand ÷ qty — the "Total Rate Per Cft." this section's table leads with. */
  perCft: number | null;
};

/** Group accent colours, cycled — donut, bars and header dots share them. */
export const GROUP_COLORS = ["#4f46e5", "#c2740a", "#0284c7", "#0f9d58", "#7c3aed", "#e11d48", "#0d9488", "#64748b"];

/** ONE section's economics: base = Σ ₹ items (amount + per_cft); % rows ride
 *  on it. `colorFrom` keeps colours unique across a multi-section sheet. */
export function computeSection(
  s: { qty: number | null; groups: TenderGroup[] },
  colorFrom = 0,
): SectionCalc {
  let base = 0;
  for (const g of s.groups) for (const it of g.items) {
    if (it.mode === "amount") base += it.value;
    else if (it.mode === "per_cft") base += it.value * (s.qty ?? 0);
  }
  const groups = s.groups.map((g, i) => ({
    id: g.id,
    title: g.title || "Untitled",
    total: g.items.reduce((acc, it) => acc + itemRupees(it, s.qty, base), 0),
    color: GROUP_COLORS[(colorFrom + i) % GROUP_COLORS.length],
  }));
  const pctAdd = groups.reduce((acc, g) => acc + g.total, 0) - base;
  const grand = base + pctAdd;
  return { base, pctAdd, grand, groups, perCft: s.qty && s.qty > 0 ? grand / s.qty : null };
}

/** Back-compat alias — a single-section computation. */
export const computeSheet = (a: { qty: number | null; groups: TenderGroup[] }): SectionCalc => computeSection(a);

export type SheetCalc = {
  /** Per-section economics, in sheet order. */
  sections: Array<SectionCalc & { id: string; title: string; uom: TenderUom; qty: number | null }>;
  base: number;
  pctAdd: number;
  /** Σ of every section — the tender value. */
  grand: number;
  /** Every group across every section, for the split chart. `section` names
   *  the master group it belongs to — group titles repeat across sections
   *  ("Raw material" exists in both sandstone and marble), so anything keying
   *  on the title alone silently merges them. */
  groups: Array<SheetGroupCalc & { section: string }>;
  /** Only meaningful on a single-section sheet; null when sections differ. */
  perCft: number | null;
  /** The single section's unit, when there is only one. */
  uom: TenderUom | null;
};

/** The whole sheet: each section priced on its own, then summed. */
export function computeSheetTotal(a: Parameters<typeof sectionsOf>[0]): SheetCalc {
  const secs = sectionsOf(a);
  let colorFrom = 0;
  const sections = secs.map((s) => {
    const c = computeSection(s, colorFrom);
    colorFrom += s.groups.length;
    return { ...c, id: s.id, title: s.title, uom: s.uom, qty: s.qty };
  });
  const groups = sections.flatMap((s, si) =>
    s.groups.map((g) => ({ ...g, section: sections.length > 1 ? s.title || `Section ${si + 1}` : "" })),
  );
  return {
    sections,
    base: sections.reduce((acc, s) => acc + s.base, 0),
    pctAdd: sections.reduce((acc, s) => acc + s.pctAdd, 0),
    grand: sections.reduce((acc, s) => acc + s.grand, 0),
    groups,
    perCft: sections.length === 1 ? sections[0].perCft : null,
    uom: sections.length === 1 ? sections[0].uom : null,
  };
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
export type QuoteTable = {
  id: string;
  /** Table caption — the section's own name, or the letter's `work` fallback. */
  title: string;
  uom: TenderUom;
  qty: number | null;
  rows: QuoteRow[];
  totalRate: number | null;
  totalAmount: number;
};

/** Flatten a sheet into the quotation's tables — one per master group, each a
 *  Sr. / Particulars / Uom. / Rate list closing on its own total rate. */
export function quoteTables(a: Parameters<typeof sectionsOf>[0], fallbackTitle: string): QuoteTable[] {
  return sectionsOf(a).map((s, si) => {
    const calc = computeSection(s);
    const rows: QuoteRow[] = [];
    for (const g of s.groups) {
      for (const it of g.items) {
        const title = (it.title || "").trim();
        const amount = itemRupees(it, s.qty, calc.base);
        if (!title && amount <= 0) continue; // never print an empty scratch row
        rows.push({
          sr: rows.length + 1,
          particulars: title || "—",
          rate: itemPerUnit(it, s.qty, calc.base),
          amount,
          group: g.title || "",
        });
      }
    }
    return {
      id: s.id || `s${si}`,
      title: (s.title || "").trim() || fallbackTitle,
      uom: s.uom,
      qty: s.qty,
      rows,
      totalRate: calc.perCft,
      totalAmount: calc.grand,
    };
  });
}

// ── version diff ──────────────────────────────────────────────────────────

export type DiffLine = {
  key: string;
  group: string;
  title: string;
  status: "same" | "changed" | "added" | "removed";
  /** Per-unit rate then / now (null when the section had no quantity). */
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
  /** True when the compared snapshots have different section counts — the
   *  headline still sums, but a per-unit rate can't be compared. */
  sectionsChanged: boolean;
};

type Side = Parameters<typeof sectionsOf>[0];

/** What changed between two snapshots of the SAME sheet. Lines are matched on
 *  their item id (stable across versions); a line whose id is gone counts as
 *  removed and its replacement as added, which is exactly how a re-priced
 *  sheet should read. */
export function diffSheets(prev: Side, next: Side): SheetDiff {
  const a = computeSheetTotal(prev);
  const b = computeSheetTotal(next);

  type Ref = { group: string; title: string; rate: number | null; amount: number };
  const index = (side: Side) => {
    const m = new Map<string, Ref>();
    const secs = sectionsOf(side);
    const multi = secs.length > 1;
    for (const s of secs) {
      const calc = computeSection(s);
      for (const g of s.groups) {
        for (const it of g.items) {
          if (!(it.title || "").trim() && itemRupees(it, s.qty, calc.base) <= 0) continue;
          const gt = g.title || "Untitled";
          m.set(it.id, {
            group: multi && s.title ? `${s.title} · ${gt}` : gt,
            title: (it.title || "").trim() || "—",
            rate: itemPerUnit(it, s.qty, calc.base),
            amount: itemRupees(it, s.qty, calc.base),
          });
        }
      }
    }
    return m;
  };
  const A = index(prev);
  const B = index(next);

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

  const label = (g: { title: string; section: string }) => (g.section ? `${g.section} · ${g.title}` : g.title);
  const gmap = new Map<string, { title: string; oldTotal: number; newTotal: number }>();
  for (const g of a.groups) gmap.set(g.id, { title: label(g), oldTotal: g.total, newTotal: 0 });
  for (const g of b.groups) {
    const e = gmap.get(g.id) ?? { title: label(g), oldTotal: 0, newTotal: 0 };
    e.newTotal = g.total;
    e.title = label(g);
    gmap.set(g.id, e);
  }
  const groups = [...gmap.values()]
    .map((g) => ({ ...g, delta: g.newTotal - g.oldTotal }))
    .filter((g) => g.oldTotal > 0 || g.newTotal > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const oneEach = a.sections.length === 1 && b.sections.length === 1;
  return {
    oldGrand: a.grand, newGrand: b.grand,
    oldPerCft: oneEach ? a.perCft : null,
    newPerCft: oneEach ? b.perCft : null,
    oldQty: oneEach ? a.sections[0].qty : null,
    newQty: oneEach ? b.sections[0].qty : null,
    delta: b.grand - a.grand,
    deltaPct: a.grand > 0 ? ((b.grand - a.grand) / a.grand) * 100 : null,
    lines,
    groups,
    changedCount: lines.filter((l) => l.status !== "same").length,
    sectionsChanged: a.sections.length !== b.sections.length,
  };
}
