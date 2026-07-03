// Work order (bulk) invoice line items → grouped tables (mig 179, Daksh Jul 2026).
// A work order invoice can hold several tables, each with its own head (e.g.
// "PinkStone"). Items carry section_index (which table, ordered) + section_head.

export const BULK_UNITS = ["CFT", "SFT", "NOS"] as const;
export type BulkUnit = (typeof BULK_UNITS)[number];

export type BulkItemInput = {
  section_index?: number | null;
  section_head?: string | null;
  position?: number | null;
  particulars?: string | null;
  hsn?: string | null;
  unit?: string | null;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
};

export type BulkSectionGroup<T> = { index: number; head: string | null; rows: T[] };

/** Group flat item rows into ordered tables (by section_index) for rendering. */
export function groupBulkItems<T extends BulkItemInput>(items: T[]): BulkSectionGroup<T>[] {
  const byIdx = new Map<number, T[]>();
  for (const it of items) {
    const idx = Number(it.section_index) || 0;
    const a = byIdx.get(idx) ?? [];
    a.push(it);
    byIdx.set(idx, a);
  }
  return [...byIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, rows]) => ({
      index,
      head: ((rows.find((r) => (r.section_head ?? "").toString().trim())?.section_head ?? null) || null) as string | null,
      rows: rows.slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)),
    }));
}
