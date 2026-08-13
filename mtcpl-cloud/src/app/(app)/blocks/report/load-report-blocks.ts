// ──────────────────────────────────────────────────────────────────
// Shared server loader for the Block Report (Daksh, Aug 2026).
//
// Why this exists: /blocks/report and /embed/blocks/report each ran their
// OWN copy of the same uncapped `.select()`. PostgREST silently caps a
// single select at 1000 rows, and the blocks table is past that (~1,500),
// so the report literally printed "Showing 463 of 1000 blocks" and left
// ~500 real blocks out of the list, the CFT/tonnage totals AND the Excel
// export. Both routes now share this one paginated loader so the fix can't
// drift back apart.
//
// ⚠ Ordering: paging needs a TOTAL order. `created_at` alone is NOT unique
//   (bulk block entry stamps many rows in the same instant), and a tie group
//   straddling a page boundary silently drops or duplicates rows. The `id`
//   tiebreaker makes each page boundary deterministic. The client sorts for
//   display anyway, so this ordering is purely for a correct walk.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";
import type { StoneCategory } from "@/lib/stone-categories";

const BLOCK_COLS =
  "id, stone, yard, category, quality, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, truck_no, vendor_name, bill_no, created_at, updated_at";

/** Mirrors the `Block` shape ReportClient renders. */
export type ReportBlockRow = {
  id: string;
  stone: string;
  yard: number;
  category: string | null;
  quality: string | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes?: number | string | null;
  truck_entry_id?: string | null;
  status: string;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** 3-face colours per stone, for the yard-preview tiles (Daksh: "block
 *  already have colors" — these are the same swatches the block cards
 *  use, via getStonePalette). */
export type StonePaletteRow = {
  name: string;
  color_top: string;
  color_front: string;
  color_side: string;
};

/** Every block (all statuses) + the stone palette the report filters by. */
export async function loadReportBlocks(): Promise<{
  blocks: ReportBlockRow[];
  stoneNames: string[];
  stoneCategoryMap: Record<string, StoneCategory>;
  stonePalettes: StonePaletteRow[];
}> {
  const admin = createAdminSupabaseClient();

  const [blocks, { data: stoneTypeRows }] = await Promise.all([
    fetchAllPaged<ReportBlockRow>((from, to) =>
      admin
        .from("blocks")
        .select(BLOCK_COLS)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) // unique tiebreaker — see header note
        .range(from, to),
    ),
    admin
      .from("stone_types")
      .select("name, stone_category, color_top, color_front, color_side")
      .order("name"),
  ]);

  const stoneNames = (stoneTypeRows ?? []).map((s) => (s as { name: string }).name);

  // Stone-name → category map so the client renders marble rows with tonnes
  // instead of dimensions (marble blocks carry NULL L×W×H — mig 007).
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneTypeRows ?? []) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[(s as { name: string }).name] = cat === "marble" ? "marble" : "sandstone";
  }

  const stonePalettes: StonePaletteRow[] = (stoneTypeRows ?? []).map((s) => {
    const r = s as StonePaletteRow;
    return {
      name: r.name,
      color_top: r.color_top,
      color_front: r.color_front,
      color_side: r.color_side,
    };
  });

  return { blocks, stoneNames, stoneCategoryMap, stonePalettes };
}
