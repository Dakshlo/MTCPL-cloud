/**
 * DPR · "Carving Done" section (Daksh, June 2026).
 *
 * Every slab whose carving is finished (carving_items.ready_to_dispatch_at —
 * the same "carving done → ready to dispatch" marker production-dpr uses),
 * grouped TEMPLE-WISE and, under each temple, split by carving vendor:
 *   CNC VENDOR TOTAL → each CNC vendor · OUTSOURCE TOTAL → each outsource vendor.
 *
 * Window date = ready_to_dispatch_at (when carving completed). Click a cell →
 * slab count. CFT = L×W×T ÷ 1728.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  type DprSection, type VendorItem,
  buildTempleVendorSection, currentWindows,
} from "@/lib/dpr-section";

const cftOf = (l: unknown, w: unknown, t: unknown): number =>
  (Number(l) * Number(w) * Number(t)) / 1728;

export async function buildCarvingDoneReport(): Promise<DprSection> {
  const admin = createAdminSupabaseClient();
  const bounds = currentWindows();

  type CI = {
    id: string; slab_requirement_id: string | null;
    vendor_type: string | null; vendor_name: string | null; ready_to_dispatch_at: string | null;
  };

  // Page through carving items that have been released (carving done) via KEYSET.
  const PAGE = 1000;
  const cis: CI[] = [];
  let lastId = "";
  for (let guard = 0; guard < 5000; guard++) {
    let q = admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_type, vendor_name, ready_to_dispatch_at")
      .not("ready_to_dispatch_at", "is", null)
      .order("id")
      .limit(PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CI[];
    cis.push(...batch);
    if (batch.length < PAGE) break;
    lastId = batch[batch.length - 1].id;
  }

  // One row per slab — keep the latest release if a slab was re-carved.
  const bySlab = new Map<string, CI>();
  for (const c of cis) {
    if (!c.slab_requirement_id || !c.ready_to_dispatch_at) continue;
    const prev = bySlab.get(c.slab_requirement_id);
    if (!prev || c.ready_to_dispatch_at > (prev.ready_to_dispatch_at ?? "")) {
      bySlab.set(c.slab_requirement_id, c);
    }
  }

  // Fetch temple + dims for those slabs (chunked .in — ≤300 ids per request).
  type SlabDim = { id: string; temple: string | null; length_ft: number | null; width_ft: number | null; thickness_ft: number | null };
  const slabMap = new Map<string, SlabDim>();
  const slabIds = [...bySlab.keys()];
  for (let i = 0; i < slabIds.length; i += 300) {
    const chunk = slabIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, temple, length_ft, width_ft, thickness_ft")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as SlabDim[]) slabMap.set(s.id, s);
  }

  const items: VendorItem[] = [];
  for (const [slabId, c] of bySlab) {
    const s = slabMap.get(slabId);
    if (!s) continue;
    items.push({
      temple: s.temple,
      cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft),
      date: c.ready_to_dispatch_at,
      vendorType: c.vendor_type === "CNC" ? "CNC" : "Outsource",
      vendorName: c.vendor_name,
    });
  }

  const { lines, total, byTemple } = buildTempleVendorSection(items, bounds);
  return { lines, total, byTemple, generatedAt: new Date().toISOString() };
}
