/**
 * DPR · "Dispatched" section (Daksh, June 2026).
 *
 * Slabs that have actually left the yard — i.e. their dispatch's truck is on the
 * road (`on_road_at` set, which happens only when the OWNER approves the invoice,
 * Mig 167). Delivered dispatches count too (they were dispatched). Grouped
 * TEMPLE-WISE then by STONE; window date = on_road_at. Click a cell → slab count.
 * CFT = L×W×T ÷ 1728.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  type DprSection, type StoneItem,
  buildTempleStoneSection, currentWindows,
} from "@/lib/dpr-section";

const cftOf = (l: unknown, w: unknown, t: unknown): number =>
  (Number(l) * Number(w) * Number(t)) / 1728;

export async function buildDispatchedReport(): Promise<DprSection> {
  const admin = createAdminSupabaseClient();
  const bounds = currentWindows();

  // Every dispatch whose truck has been released (on_road_at set). KEYSET paged.
  type D = { id: string; temple: string | null; on_road_at: string | null };
  const dispatches: D[] = [];
  const PAGE = 1000;
  let lastId = "";
  for (let guard = 0; guard < 5000; guard++) {
    let q = admin
      .from("dispatches")
      .select("id, temple, on_road_at")
      .not("on_road_at", "is", null)
      .order("id")
      .limit(PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as D[];
    dispatches.push(...batch);
    if (batch.length < PAGE) break;
    lastId = batch[batch.length - 1].id;
  }
  const dispById = new Map(dispatches.map((d) => [d.id, d]));
  const dispIds = dispatches.map((d) => d.id);

  // dispatch_logs → the slabs on each released dispatch (chunked .in).
  type Log = { dispatch_id: string | null; slab_requirement_id: string | null };
  const logs: Log[] = [];
  for (let i = 0; i < dispIds.length; i += 300) {
    const chunk = dispIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data, error } = await admin
      .from("dispatch_logs")
      .select("dispatch_id, slab_requirement_id")
      .in("dispatch_id", chunk);
    if (error) throw new Error(error.message);
    logs.push(...((data ?? []) as Log[]));
  }
  const slabIds = [...new Set(logs.map((l) => l.slab_requirement_id).filter(Boolean) as string[])];

  // Slab stone + dims.
  type S = { id: string; stone: string | null; length_ft: number | null; width_ft: number | null; thickness_ft: number | null };
  const slabMap = new Map<string, S>();
  for (let i = 0; i < slabIds.length; i += 300) {
    const chunk = slabIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, stone, length_ft, width_ft, thickness_ft")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as S[]) slabMap.set(s.id, s);
  }

  const items: StoneItem[] = [];
  for (const l of logs) {
    if (!l.dispatch_id || !l.slab_requirement_id) continue;
    const d = dispById.get(l.dispatch_id);
    const s = slabMap.get(l.slab_requirement_id);
    if (!d || !s) continue;
    items.push({ temple: d.temple, stone: s.stone, cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft), date: d.on_road_at });
  }

  const { lines, total } = buildTempleStoneSection(items, bounds);
  return { lines, total, generatedAt: new Date().toISOString() };
}
