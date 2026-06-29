/**
 * DPR · "Block Cutted" section (Daksh, June 2026).
 *
 * Every physically-cut slab (POST_CUT_STATUSES + later carving-rejected /
 * cancelled, which were still cut), grouped TEMPLE-WISE and, under each temple,
 * split by STONE (Daksh — the cut slabs per site per stone, NOT per carver;
 * carver breakdown lives on Carving Done).
 *
 * Window date = the slab's CUT-DONE date — its source block's cut event
 * (cutDoneDateByBlock), else the slab's own pre-cut release, else created_at.
 * Click a cell → slab count. CFT = L×W×T ÷ 1728.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { cutDoneDateByBlock } from "@/lib/cut-done-date";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import {
  type DprSection, type StoneItem,
  buildTempleStoneSection, currentWindows,
} from "@/lib/dpr-section";

const cftOf = (l: unknown, w: unknown, t: unknown): number =>
  (Number(l) * Number(w) * Number(t)) / 1728;

// Every physically-cut slab. POST_CUT_STATUSES plus carving_rejected +
// cancelled — both only reachable AFTER cutting (CANCELLABLE_STATUSES are all
// post-cut, and carving rejection happens after carving), so they were
// genuinely cut and must keep counting toward the temple total. Scoped to this
// report; the shared POST_CUT_STATUSES constant is left untouched.
const CUT_SLAB_STATUSES = [...POST_CUT_STATUSES, "carving_rejected", "cancelled"];

export async function buildBlockCuttedReport(): Promise<DprSection> {
  const admin = createAdminSupabaseClient();
  const bounds = currentWindows();

  type Row = {
    id: string; temple: string | null; stone: string | null;
    length_ft: number | null; width_ft: number | null; thickness_ft: number | null;
    source_block_id: string | null; precut_at: string | null; created_at: string | null;
  };

  // Page through every physically-cut slab via KEYSET (id cursor).
  const PAGE = 1000;
  const rows: Row[] = [];
  let lastId = "";
  for (let guard = 0; guard < 5000; guard++) {
    let q = admin
      .from("slab_requirements")
      .select("id, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, precut_at, created_at")
      .in("status", CUT_SLAB_STATUSES)
      .order("id")
      .limit(PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    lastId = batch[batch.length - 1].id;
  }

  const cutByBlock = await cutDoneDateByBlock(admin, rows.map((r) => r.source_block_id));

  const items: StoneItem[] = rows.map((s) => {
    // Cut date: source-block cut event → the slab's own pre-cut release → created_at.
    const date = (s.source_block_id ? cutByBlock.get(s.source_block_id) : null) ?? s.precut_at ?? s.created_at;
    return {
      temple: s.temple,
      stone: s.stone,
      cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft),
      date,
    };
  });

  const { lines, total, byTemple } = buildTempleStoneSection(items, bounds);
  return { lines, total, byTemple, generatedAt: new Date().toISOString() };
}
