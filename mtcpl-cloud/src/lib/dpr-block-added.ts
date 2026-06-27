/**
 * DPR · "Block Added" section data (Daksh, June 2026).
 *
 * For the MTCPL plant: every block ADDED (blocks.created_at), grouped
 * STONE-WISE and, under each stone, by VENDOR (blocks.vendor_name).
 * Blocks with no vendor fall under a synthetic "NO VENDOR" row (Daksh:
 * "show them as no vendor"), so the stone total = sum of its vendor rows
 * and the grand total = sum of all stones.
 *
 * NOTE: marble blocks are tonnage-based and carry NO L×W×H (dims are NULL
 * since mig 007), so their CFT is 0. The grid surfaces those cells as a
 * block COUNT instead of a misleading "0.00".
 *
 * Each cell carries BOTH cft and the block COUNT, across four windows the
 * grid shows as columns: Daily (today), 7 Days (last 7 incl. today), Month
 * (current calendar month), All Time. The grid lets the user click a cell
 * to flip CFT ↔ count.
 *
 * CFT = L×W×H ÷ 1728 (the *_ft columns hold INCHES — legacy naming).
 * Windows are computed in IST. blocks.created_at is paginated past the
 * PostgREST 1000-row cap.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type DprWin = { cft: number; count: number };
export type DprWindows = { daily: DprWin; week: DprWin; month: DprWin; allTime: DprWin };
export type DprVendorAgg = { vendor: string; windows: DprWindows };
export type DprStoneAgg = { stone: string; windows: DprWindows; vendors: DprVendorAgg[] };
export type BlockAddedReport = { stones: DprStoneAgg[]; total: DprWindows; generatedAt: string };

const cftOf = (l: unknown, w: unknown, h: unknown): number =>
  (Number(l) * Number(w) * Number(h)) / 1728;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** YYYY-MM-DD of an absolute instant, in IST. */
function istKeyOf(ms: number): string {
  const d = new Date(ms + 5.5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** A date-key minus N days, still as a YYYY-MM-DD key. */
function keyMinusDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return istKeyOf(Date.UTC(y, m - 1, d) - days * 86_400_000 - 5.5 * 60 * 60 * 1000);
}

function emptyWin(): DprWin { return { cft: 0, count: 0 }; }
function emptyWindows(): DprWindows {
  return { daily: emptyWin(), week: emptyWin(), month: emptyWin(), allTime: emptyWin() };
}
function add(win: DprWindows, cft: number, f: { daily: boolean; week: boolean; month: boolean }): void {
  if (f.daily) { win.daily.cft += cft; win.daily.count += 1; }
  if (f.week) { win.week.cft += cft; win.week.count += 1; }
  if (f.month) { win.month.cft += cft; win.month.count += 1; }
  win.allTime.cft += cft; win.allTime.count += 1;
}

export async function buildBlockAddedReport(): Promise<BlockAddedReport> {
  const admin = createAdminSupabaseClient();

  const todayKey = istKeyOf(Date.now());
  const weekStartKey = keyMinusDays(todayKey, 6); // last 7 days incl. today
  const curYm = todayKey.slice(0, 7);

  type Row = {
    stone: string | null;
    vendor_name: string | null;
    length_ft: number; width_ft: number; height_ft: number;
    created_at: string | null;
  };

  // Page through every vendored block (PostgREST caps .select() at 1000).
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0, guard = 0; guard < 2000; guard++, offset += PAGE) {
    const { data, error } = await admin
      .from("blocks")
      .select("stone, vendor_name, length_ft, width_ft, height_ft, created_at")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const stoneMap = new Map<string, { windows: DprWindows; vendors: Map<string, DprWindows> }>();
  const total = emptyWindows();

  for (const b of rows) {
    const vendor = (b.vendor_name ?? "").trim() || "NO VENDOR";
    const stone = (b.stone ?? "").trim() || "—";
    const cft = cftOf(b.length_ft, b.width_ft, b.height_ft);
    const bKey = b.created_at ? istKeyOf(new Date(b.created_at).getTime()) : "";
    const f = {
      daily: bKey === todayKey,
      week: bKey >= weekStartKey && bKey <= todayKey,
      month: bKey.slice(0, 7) === curYm,
    };

    let s = stoneMap.get(stone);
    if (!s) { s = { windows: emptyWindows(), vendors: new Map() }; stoneMap.set(stone, s); }
    add(s.windows, cft, f);

    let v = s.vendors.get(vendor);
    if (!v) { v = emptyWindows(); s.vendors.set(vendor, v); }
    add(v, cft, f);

    add(total, cft, f);
  }

  // Biggest contributors first by all-time CFT, then by block count (so
  // zero-CFT tonnage stones like marble order by how many blocks they hold
  // instead of all tying at 0), then alphabetical.
  const byVol = (a: DprWindows, b: DprWindows) =>
    b.allTime.cft - a.allTime.cft || b.allTime.count - a.allTime.count;
  const stones: DprStoneAgg[] = [...stoneMap.entries()]
    .map(([stone, s]) => ({
      stone,
      windows: s.windows,
      vendors: [...s.vendors.entries()]
        .map(([vendor, w]) => ({ vendor, windows: w }))
        .sort((a, b) => byVol(a.windows, b.windows) || a.vendor.localeCompare(b.vendor)),
    }))
    .sort((a, b) => byVol(a.windows, b.windows) || a.stone.localeCompare(b.stone));

  return { stones, total, generatedAt: new Date().toISOString() };
}
