/**
 * Embed-mode Block Journey. Same data fetching + same auth guard as
 * the standalone /block-journey page, just rendered inside the
 * minimal embed layout (no sidebar / header) so it fits cleanly
 * inside the PeekIframe modal opened from the dashboard.
 *
 * Standalone /block-journey continues to work; this is just an
 * alternate render path for the iframe.
 */

import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { BlockJourneyClient } from "@/components/block-journey-client";
import type { StoneCategory } from "@/lib/stone-categories";
import {
  buildLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
  type BjMarbleTruckRow,
} from "@/app/(app)/block-journey/build-lineages";

type SearchParams = Promise<{ mode?: string }>;

export default async function EmbedBlockJourneyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  const isAllowed =
    profile.role === "owner" ||
    profile.role === "developer" ||
    canTransferPlannedSlabs(profile);
  if (!isAllowed) {
    redirect(getDefaultRouteForRole(profile.role));
  }
  const { mode } = await searchParams;
  const initialMode = "recovered" as const;
  void mode;

  const admin = createAdminSupabaseClient();

  const [freshR, reusedR, cutDoneR, doneCsbR, stoneTypesR, trucksR] = await Promise.all([
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, created_at, created_by, updated_at",
      )
      .eq("category", "Fresh"),
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, created_at, created_by, updated_at",
      )
      .eq("category", "Reused"),
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .eq("status", "cut_done"),
    admin
      .from("cut_session_blocks")
      .select("block_id, status, updated_at")
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
