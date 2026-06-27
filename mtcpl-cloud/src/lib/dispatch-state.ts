/**
 * slab_id → its latest dispatch's {approvedAt, deliveredAt} (Daksh June
 * 2026). Lets a slab whose status is 'dispatched' show the right sub-state
 * label — "Dispatch approval pending" / "On the way to site" / "Delivered"
 * (see slab-status-label.ts). Only slabs that are on a dispatch appear in
 * the returned map.
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { SlabDispatchState } from "@/lib/slab-status-label";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function dispatchStateBySlab(
  admin: AdminClient,
  slabIds: Array<string | null | undefined>,
): Promise<Map<string, SlabDispatchState>> {
  const out = new Map<string, SlabDispatchState>();
  const ids = [...new Set(slabIds.filter((s): s is string => !!s))];
  if (ids.length === 0) return out;

  // slab → its most-recent dispatch (a slab can be recalled + re-dispatched).
  const latest = new Map<string, { dispatchId: string; at: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data } = await admin
      .from("dispatch_logs")
      .select("slab_requirement_id, dispatch_id, dispatched_at")
      .in("slab_requirement_id", chunk)
      .not("dispatch_id", "is", null);
    for (const r of (data ?? []) as Array<{ slab_requirement_id: string; dispatch_id: string | null; dispatched_at: string | null }>) {
      if (!r.dispatch_id) continue;
      const at = r.dispatched_at ?? "";
      const prev = latest.get(r.slab_requirement_id);
      if (!prev || at > prev.at) latest.set(r.slab_requirement_id, { dispatchId: r.dispatch_id, at });
    }
  }

  const dispatchIds = [...new Set([...latest.values()].map((v) => v.dispatchId))];
  const byDispatch = new Map<string, { approvedAt: string | null; deliveredAt: string | null }>();
  for (let i = 0; i < dispatchIds.length; i += 300) {
    const chunk = dispatchIds.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data } = await admin.from("dispatches").select("id, approved_at, delivered_at").in("id", chunk);
    for (const d of (data ?? []) as Array<{ id: string; approved_at: string | null; delivered_at: string | null }>) {
      byDispatch.set(d.id, { approvedAt: d.approved_at, deliveredAt: d.delivered_at });
    }
  }

  for (const [slabId, { dispatchId }] of latest) {
    const st = byDispatch.get(dispatchId);
    if (st) out.set(slabId, { approvedAt: st.approvedAt, deliveredAt: st.deliveredAt });
  }
  return out;
}
