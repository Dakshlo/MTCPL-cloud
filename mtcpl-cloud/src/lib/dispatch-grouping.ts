/**
 * Dispatch slab grouping + measure helpers.
 *
 * Shared by the dispatch "Check & verify" grid, the landscape challan, the
 * dispatch→invoicing bridge, and the invoicing review/invoice so every surface
 * shows the SAME Excel rows.
 *
 * Grouping rule (Daksh): identical slabs collapse into ONE row with a quantity.
 * "Identical" = same label + description + additional description + Category 1
 * + Category 2 + L + W + H. The row's `codes` lists every collapsed slab code.
 *
 * Measure: dimensions are stored in INCHES (the columns are misleadingly named
 * *_ft). CFT = L·W·T / 1728 (cubic feet). SFT = (two largest dims) / 144 — the
 * face area; the smallest dim is the thickness, and it can sit in ANY of the
 * three columns (jali slabs are entered 38×3×22). Each row is billed in cft
 * (default) or sft.
 */

export type DispatchSlabInput = {
  /** slab_requirements.id — the human code shown in the Code column. */
  id: string;
  label: string | null;
  description: string | null;
  additional_description: string | null;
  /** Category 1. */
  component_section: string | null;
  /** Category 2. */
  component_element: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  /** dispatch_logs.weight_tonnes for this slab (nullable). */
  weight_tonnes: number | null;
  /** dispatch_logs.measure_unit — the billing unit chosen at Check time. */
  measure_unit: "cft" | "sft";
  /** Stone type — optional. When provided, slabs of different stones never
   *  merge and the challan/invoice can group stone-wise → cft/sft within. */
  stone?: string | null;
};

export type DispatchGroupRow = {
  /** Stable identity key (no unit) — same across cft/sft toggles. */
  key: string;
  /** Every slab code in the group (preserves input order). */
  codes: string[];
  /** Underlying slab ids — what to write back / remove. */
  slabIds: string[];
  qty: number;
  label: string | null;
  description: string | null;
  additional_description: string | null;
  component_section: string | null;
  component_element: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  /** Stone type of the group (null when callers don't supply it). */
  stone: string | null;
  /** Summed weight over the group (tonnes); 0 if none entered. */
  weightTonnes: number;
  /** Billing unit for the whole group. */
  measure_unit: "cft" | "sft";
  /** Per-piece cft / sft. */
  cftEach: number;
  sftEach: number;
  /** qty × per-piece, for the chosen unit. */
  measureQty: number;
};

export function cftOf(lengthIn: number, widthIn: number, thicknessIn: number): number {
  return (lengthIn * widthIn * thicknessIn) / 1728;
}

/** Face area in square feet. The three dim columns are display order (L·W·H),
 *  not physical roles — on jali/khadasal slabs the 3" THICKNESS often sits in
 *  the middle (38×3×22). The thickness is always the SMALLEST of the three, so
 *  the face = product of the two LARGEST dims. (Jul 2026 fix: this used L·W,
 *  which multiplied by the thickness → 38×3 = 0.79 sft instead of the real
 *  face 38×22 = 5.81 sft — every SFT row was ~10× too small.) */
export function sftOf(lengthIn: number, widthIn: number, thicknessIn: number): number {
  const smallest = Math.min(lengthIn, widthIn, thicknessIn);
  const product = lengthIn * widthIn * thicknessIn;
  if (smallest <= 0) return 0; // degenerate/missing dim — no face to measure
  return product / smallest / 144;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Blank → "-" for print + the Excel-like portals. */
export function dash(v: string | number | null | undefined): string {
  if (v == null) return "-";
  const s = String(v).trim();
  return s === "" ? "-" : s;
}

/**
 * Collapse identical slabs into grouped rows. The group's billing unit is the
 * unit of its first member (callers can override per row in the UI). Order of
 * first appearance is preserved.
 */
export function groupDispatchSlabs(slabs: DispatchSlabInput[]): DispatchGroupRow[] {
  const map = new Map<string, DispatchGroupRow>();
  for (const s of slabs) {
    const l = num(s.length_ft);
    const w = num(s.width_ft);
    const t = num(s.thickness_ft);
    const key = [
      norm(s.stone),
      norm(s.label),
      norm(s.description),
      norm(s.additional_description),
      norm(s.component_section),
      norm(s.component_element),
      l,
      w,
      t,
    ].join("¦");
    const existing = map.get(key);
    if (existing) {
      existing.codes.push(s.id);
      existing.slabIds.push(s.id);
      existing.qty += 1;
      existing.weightTonnes += num(s.weight_tonnes);
    } else {
      const cftEach = cftOf(l, w, t);
      const sftEach = sftOf(l, w, t);
      map.set(key, {
        key,
        codes: [s.id],
        slabIds: [s.id],
        qty: 1,
        label: s.label,
        description: s.description,
        additional_description: s.additional_description,
        component_section: s.component_section,
        component_element: s.component_element,
        length_ft: l,
        width_ft: w,
        thickness_ft: t,
        stone: s.stone ?? null,
        weightTonnes: num(s.weight_tonnes),
        measure_unit: s.measure_unit === "sft" ? "sft" : "cft",
        cftEach,
        sftEach,
        measureQty: 0,
      });
    }
  }
  const rows = [...map.values()];
  for (const r of rows) {
    r.measureQty = (r.measure_unit === "sft" ? r.sftEach : r.cftEach) * r.qty;
  }
  return rows;
}

/**
 * Split grouped rows by stone (alphabetical), preserving each stone's row
 * order. Used by the challan + invoice to print stone-wise sections, with
 * CFT and SFT sub-tables inside each. Rows with no stone fall under "—".
 */
export function groupRowsByStone(
  rows: DispatchGroupRow[],
): Array<{ stone: string; rows: DispatchGroupRow[] }> {
  const map = new Map<string, DispatchGroupRow[]>();
  for (const r of rows) {
    const stone = (r.stone ?? "").trim() || "—";
    const list = map.get(stone) ?? [];
    list.push(r);
    map.set(stone, list);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([stone, rows]) => ({ stone, rows }));
}
