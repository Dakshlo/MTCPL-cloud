/**
 * Block Journey — Real Efficiency Report.
 *
 * Server component. Auth-gated to owner + developer + the trusted
 * named users (Naresh, Rajesh Kumar) — Rajesh is stored as team_head
 * but his stripped dashboard surfaces the Block Journey entry card,
 * so he needs to actually be able to open the page.
 * Bulk-fetches every table needed, calls buildLineages() once, and
 * hands the result to the client component for filtering / sorting.
 *
 * Four Supabase round-trips total (no N+1):
 *   1. Fresh blocks
 *   2. Reused blocks
 *   3. cut_done slab_requirements (with source_block_id)
 *   4. done cut_session_blocks
 * Plus the cached profiles map.
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
} from "./build-lineages";

type SearchParams = Promise<{ mode?: string }>;

export default async function BlockJourneyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Permissive requireAuth + inline guard so trusted named users
  // (Naresh, Rajesh) get in even if their stored role isn't owner.
  // Same pattern as /dashboard.
  const { profile } = await requireAuth();
  const isAllowed =
    profile.role === "owner" ||
    profile.role === "developer" ||
    canTransferPlannedSlabs(profile);
  if (!isAllowed) {
    redirect(getDefaultRouteForRole(profile.role));
  }
  const { mode } = await searchParams;
  // Default is "recovered" (optimistic, judges cutter performance). Users
  // Mode is now hard-locked to "recovered" — the team only ever wants
  // the recovered metric (slabs + live remainders ÷ original). The URL
  // ?mode=... param is read but ignored to keep the door open for a
  // future per-user preference.
  const initialMode = "recovered" as const;
  void mode; // suppress unused-var since we accept the URL param but ignore it

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
