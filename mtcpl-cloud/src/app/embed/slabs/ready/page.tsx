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
import { ReadySlabsClient } from "@/app/(app)/slabs/ready/ready-client";

export default async function EmbedReadySlabsPage() {
  await requireAuth(["owner", "team_head", "block_slab_entry"]);
  const admin = createAdminSupabaseClient();

  const [{ data, error }, { data: stoneTypeRows }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at")
      .eq("status", "cut_done")
      .order("updated_at", { ascending: false }),
    admin.from("stone_types").select("name").order("name"),
  ]);

  if (error) throw new Error(error.message);

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);
  const templeNames = [...new Set((data ?? []).map((s) => s.temple))].sort();

  return (
    <ReadySlabsClient
      slabs={data ?? []}
      stoneNames={stoneNames}
      templeNames={templeNames}
    />
  );
}
