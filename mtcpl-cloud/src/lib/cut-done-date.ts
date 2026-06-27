/**
 * Real cut-done date per block (Daksh June 2026).
 *
 * slab_requirements has no cut timestamp, and slab.updated_at moves on
 * every later edit (carving assign, dispatch, any tweak) — so it must NOT
 * be used as "Cut Done". The true cut event is:
 *   • formal cuts  → cut_session_blocks.updated_at WHERE status='done'
 *                    (the cutting-audit approval moment)
 *   • manual cuts  → the manual_cut_block audit_logs.created_at
 * both keyed by the block id (= slab_requirements.source_block_id).
 *
 * Returns a Map<block_id, ISO date> (latest event wins per block). A block
 * is cut once, so formal/manual don't normally co-occur. Callers fall back
 * to the slab's own created_at when a block isn't in the map (external /
 * direct-dispatch slabs that were never formally/manually cut here).
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function cutDoneDateByBlock(
  admin: AdminClient,
  blockIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(blockIds.filter((b): b is string => !!b))];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    if (chunk.length === 0) break;
    const [{ data: csb }, { data: mc }] = await Promise.all([
      admin
        .from("cut_session_blocks")
        .select("block_id, updated_at")
        .eq("status", "done")
        .in("block_id", chunk),
      admin
        .from("audit_logs")
        .select("entity_id, created_at")
        .eq("action", "manual_cut_block")
        .eq("entity_type", "block")
        .in("entity_id", chunk),
    ]);
    for (const r of (csb ?? []) as Array<{ block_id: string; updated_at: string | null }>) {
      if (!r.updated_at) continue;
      const prev = out.get(r.block_id);
      if (!prev || r.updated_at > prev) out.set(r.block_id, r.updated_at);
    }
    for (const r of (mc ?? []) as Array<{ entity_id: string; created_at: string | null }>) {
      if (!r.created_at) continue;
      const prev = out.get(r.entity_id);
      if (!prev || r.created_at > prev) out.set(r.entity_id, r.created_at);
    }
  }
  return out;
}
