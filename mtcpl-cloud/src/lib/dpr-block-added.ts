/**
 * DPR · "Block Added" section (Daksh, June 2026).
 *
 * Every block ADDED (blocks.created_at), grouped STONE-WISE and, under each
 * stone, by VENDOR (blocks.vendor_name). Blocks with no vendor fall under a
 * synthetic "NO VENDOR" item, so the stone total = sum of its vendor rows and
 * the grand total = sum of all stones.
 *
 * Sandstone is measured in CFT (L×W×H); marble is tonnage-based and carries
 * NO L×W×H (dims NULL since mig 007), so its CFT is 0 and the grid shows its
 * TONNES instead. Both are accumulated; the grid picks CFT when present, else
 * tonnes, and flips to the block count on click.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  type DprLine, type DprSection, type DprWindows,
  addWin, byVolume, currentWindows, emptyWindows, windowFlags,
} from "@/lib/dpr-section";

const cftOf = (l: unknown, w: unknown, h: unknown): number =>
  (Number(l) * Number(w) * Number(h)) / 1728;

export async function buildBlockAddedReport(): Promise<DprSection> {
  const admin = createAdminSupabaseClient();
  const bounds = currentWindows();

  type Row = {
    id: string; stone: string | null; vendor_name: string | null;
    length_ft: number | null; width_ft: number | null; height_ft: number | null;
    tonnes: number | null; created_at: string | null;
  };

  // Page through every block via KEYSET (id cursor) — O(n), stable.
  const PAGE = 1000;
  const rows: Row[] = [];
  let lastId = "";
  for (let guard = 0; guard < 5000; guard++) {
    let q = admin
      .from("blocks")
      .select("id, stone, vendor_name, length_ft, width_ft, height_ft, tonnes, created_at")
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

  const stoneMap = new Map<string, { windows: DprWindows; vendors: Map<string, DprWindows> }>();
  const total = emptyWindows();

  for (const b of rows) {
    const vendor = (b.vendor_name ?? "").trim() || "NO VENDOR";
    const stone = (b.stone ?? "").trim() || "—";
    const v = { cft: cftOf(b.length_ft, b.width_ft, b.height_ft), tonnes: Number(b.tonnes) || 0 };
    const f = windowFlags(b.created_at, bounds);

    let g = stoneMap.get(stone);
    if (!g) { g = { windows: emptyWindows(), vendors: new Map() }; stoneMap.set(stone, g); }
    addWin(g.windows, v, f);

    let it = g.vendors.get(vendor);
    if (!it) { it = emptyWindows(); g.vendors.set(vendor, it); }
    addWin(it, v, f);

    addWin(total, v, f);
  }

  const lines: DprLine[] = [];
  const stones = [...stoneMap.entries()].sort(
    (a, b) => byVolume(a[1].windows, b[1].windows) || a[0].localeCompare(b[0]),
  );
  for (const [stone, g] of stones) {
    lines.push({ tone: "group", label: stone, windows: g.windows });
    const vendors = [...g.vendors.entries()].sort(
      (a, b) => byVolume(a[1], b[1]) || a[0].localeCompare(b[0]),
    );
    for (const [vendor, w] of vendors) lines.push({ tone: "item", label: vendor, windows: w });
  }

  return { lines, total, generatedAt: new Date().toISOString() };
}
