/**
 * Block Journey — Real Efficiency Report.
 *
 * Server component. Auth-gated to owner + developer. Bulk-fetches every
 * table needed, calls buildLineages() once, and hands the result to the
 * client component for filtering / sorting / rendering.
 *
 * Four Supabase round-trips total (no N+1):
 *   1. Fresh blocks
 *   2. Reused blocks
 *   3. cut_done slab_requirements (with source_block_id)
 *   4. done cut_session_blocks
 * Plus the cached profiles map.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { BlockJourneyClient } from "@/components/block-journey-client";
import type { StoneCategory } from "@/lib/stone-categories";
import {
  buildLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
  type BjMarbleTruckRow,
} from "./build-lineages";

type SearchParams = Promise<{ mode?: string }>;

export default async function BlockJourneyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth(["owner", "developer"]);
  const { mode } = await searchParams;
  // Default is "recovered" (optimistic, judges cutter performance). Users
  // who prefer the conservative "yield" framing can flip via the toggle —
  // the URL will carry ?mode=yield for that.
  const initialMode = mode === "yield" ? "yield" : "recovered";

  const admin = createAdminSupabaseClient();

  const [freshR, reusedR, cutDoneR, doneCsbR, stoneTypesR, trucksR] = await Promise.all([
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, created_at, created_by",
      )
      .eq("category", "Fresh"),
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, created_at, created_by",
      )
      .eq("category", "Reused"),
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .eq("status", "cut_done"),
    admin
      .from("cut_session_blocks")
      .select("block_id, status")
      .eq("status", "done"),
    admin.from("stone_types").select("name, stone_category").order("name"),
    admin
      .from("marble_truck_entries")
      .select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at"),
  ]);

  const freshBlocks = (freshR.data ?? []) as BjBlockRow[];
  const reusedBlocks = (reusedR.data ?? []) as BjBlockRow[];
  const cutDoneSlabs = (cutDoneR.data ?? []) as BjSlabRow[];
  const doneCsbs = (doneCsbR.data ?? []) as BjCsbRow[];
  const trucks = (trucksR.data ?? []) as BjMarbleTruckRow[];

  // Build the stone-name → category map so buildLineages can branch
  // per block.
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneTypesR.data ?? []) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[(s as { name: string }).name] =
      cat === "marble" ? "marble" : "sandstone";
  }

  const lineages = buildLineages(
    freshBlocks,
    reusedBlocks,
    cutDoneSlabs,
    doneCsbs,
    stoneCategoryMap,
    trucks,
  );
  const profilesMap = await getProfilesMap();

  const stoneOptions = (stoneTypesR.data ?? [])
    .map((s: { name: string }) => s.name)
    .filter(Boolean);

  return (
    <BlockJourneyClient
      lineages={lineages}
      profilesMap={profilesMap}
      stoneOptions={stoneOptions}
      stoneCategoryMap={stoneCategoryMap}
      initialMode={initialMode}
    />
  );
}
