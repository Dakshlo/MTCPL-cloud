/**
 * DPR · "Block Cutted" section (Daksh, June 2026).
 *
 * Every slab physically produced from cutting (POST_CUT_STATUSES), grouped
 * TEMPLE-WISE and, under each temple, listed as INDIVIDUAL SLABS ("if there
 * is more than 1 slab show them separate"). Temple total = sum of its slabs;
 * grand total = sum of all temples. Click a cell to flip CFT ↔ slab count.
 *
 * Window date = the slab's CUT-DONE date — the cut-session/manual-cut event
 * of its source block (cutDoneDateByBlock), falling back to the slab's own
 * created_at for external / direct-dispatch slabs that were never cut here.
 *
 * CFT = L×W×T ÷ 1728 (the *_ft columns hold INCHES).
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { cutDoneDateByBlock } from "@/lib/cut-done-date";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import {
  type DprSection, type DprWindows,
  addWin, byVolume, currentWindows, emptyWindows, windowFlags,
} from "@/lib/dpr-section";

const cftOf = (l: unknown, w: unknown, t: unknown): number =>
  (Number(l) * Number(w) * Number(t)) / 1728;

export async function buildBlockCuttedReport(): Promise<DprSection> {
  const admin = createAdminSupabaseClient();
  const bounds = currentWindows();

  type Row = {
    id: string; temple: string | null;
    length_ft: number | null; width_ft: number | null; thickness_ft: number | null;
    source_block_id: string | null; precut_at: string | null; created_at: string | null;
  };

  // Page through every physically-cut slab via KEYSET (id cursor) — O(n),
  // avoids deep-OFFSET re-scan on this (the largest) table.
  const PAGE = 1000;
  const rows: Row[] = [];
  let lastId = "";
  for (let guard = 0; guard < 5000; guard++) {
    let q = admin
      .from("slab_requirements")
      .select("id, temple, length_ft, width_ft, thickness_ft, source_block_id, precut_at, created_at")
      .in("status", [...POST_CUT_STATUSES])
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

  // Real cut date per source block (cut-session 'done' ∪ manual-cut audit).
  const cutByBlock = await cutDoneDateByBlock(admin, rows.map((r) => r.source_block_id));

  const groupMap = new Map<string, { windows: DprWindows; items: Map<string, DprWindows> }>();
  const total = emptyWindows();

  for (const s of rows) {
    const temple = (s.temple ?? "").trim() || "—";
    const v = { cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft), tonnes: 0 };
    // Cut date: source-block cut event → the slab's own pre-cut release moment
    // (block not yet fully done) → created_at (external/direct slabs).
    const cutDate =
      (s.source_block_id ? cutByBlock.get(s.source_block_id) : null) ?? s.precut_at ?? s.created_at;
    const f = windowFlags(cutDate, bounds);

    let g = groupMap.get(temple);
    if (!g) { g = { windows: emptyWindows(), items: new Map() }; groupMap.set(temple, g); }
    addWin(g.windows, v, f);

    // Each slab is its own row (unique by id → count 1).
    let it = g.items.get(s.id);
    if (!it) { it = emptyWindows(); g.items.set(s.id, it); }
    addWin(it, v, f);

    addWin(total, v, f);
  }

  const groups = [...groupMap.entries()]
    .map(([label, g]) => ({
      label,
      windows: g.windows,
      items: [...g.items.entries()]
        .map(([l, w]) => ({ label: l, windows: w }))
        .sort((a, b) => byVolume(a.windows, b.windows) || a.label.localeCompare(b.label, undefined, { numeric: true })),
    }))
    .sort((a, b) => byVolume(a.windows, b.windows) || a.label.localeCompare(b.label));

  return { groups, total, generatedAt: new Date().toISOString() };
}
