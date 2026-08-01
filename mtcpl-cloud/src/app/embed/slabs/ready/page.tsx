/**
 * Embed-mode Ready Sizes (cut-done slab inventory).
 *
 * Same data fetching as the standalone /slabs/ready page but
 * without the page header — designed to be loaded inside a
 * PeekIframe modal from the dashboard so the team can review +
 * export ready slabs without navigating away.
 *
 * Standalone /slabs/ready continues to work for direct nav.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { cutDoneDateByBlock } from "@/lib/cut-done-date";
import { dispatchStateBySlab } from "@/lib/dispatch-state";
import { ReadySlabsClient } from "@/app/(app)/slabs/ready/ready-client";

// Match the standalone /slabs/ready page: the embed kiosk view must
// show the same slabs (including ones in carving / dispatch / rejected),
// otherwise the kiosk and the in-app page give different counts for the
// same block — the bug Daksh hit with MT-B-246. POST_CUT_STATUSES is the
// shared canonical set so this never drifts.

export default async function EmbedReadySlabsPage() {
  await requireAuth(["owner", "team_head", "block_slab_entry"]);
  const admin = createAdminSupabaseClient();

  // Paginated (Daksh, Aug 2026): this embed copy ran an uncapped .select()
  // while the standalone page already paged, so the kiosk/modal view silently
  // stopped at PostgREST's 1000-row cap and showed FEWER ready slabs than the
  // in-app page — exactly the kiosk-vs-page mismatch POST_CUT_STATUSES was
  // introduced to prevent. `id` is the unique tiebreaker: `updated_at` alone
  // isn't unique, and a tie group straddling a page boundary drops rows.
  const [data, { data: stoneTypeRows }] = await Promise.all([
    fetchAllPaged<{
      id: string;
      // `label` matches the standalone page's ReadySlabRow (non-null) — the
      // client's Slab type requires it and every post-cut slab carries one.
      label: string;
      temple: string;
      stone: string | null;
      quality: string | null;
      length_ft: number;
      width_ft: number;
      thickness_ft: number;
      status: string;
      priority: boolean;
      created_at: string | null;
      updated_at: string | null;
      source_block_id: string | null;
    }>((from, to) =>
      admin
        .from("slab_requirements")
        .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, source_block_id")
        .in("status", POST_CUT_STATUSES)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    admin.from("stone_types").select("name").order("name"),
  ]);

  // Real cut-done date (NOT updated_at) — same as the standalone page.
  const cutDates = await cutDoneDateByBlock(admin, (data ?? []).map((s) => s.source_block_id));
  const dispatchStates = await dispatchStateBySlab(
    admin,
    (data ?? []).filter((s) => s.status === "dispatched").map((s) => s.id),
  );
  const slabsWithCutDate = (data ?? []).map((s) => ({
    ...s,
    cut_done_at:
      (s.source_block_id ? cutDates.get(s.source_block_id) : undefined) ?? s.created_at ?? s.updated_at,
    dispatch_state: dispatchStates.get(s.id) ?? null,
  }));

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);
  const templeNames = [...new Set((data ?? []).map((s) => s.temple))].sort();

  return (
    <ReadySlabsClient
      slabs={slabsWithCutDate}
      stoneNames={stoneNames}
      templeNames={templeNames}
    />
  );
}
