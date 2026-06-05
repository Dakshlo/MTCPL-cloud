/**
 * Embed-mode Block Journey. Same data fetching + same auth guard as
 * the standalone /block-journey page, just rendered inside the
 * minimal embed layout (no sidebar / header) so it fits cleanly
 * inside the PeekIframe modal opened from the dashboard.
 *
 * Standalone /block-journey continues to work; this is just an
 * alternate render path for the iframe.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { BlockJourneyClient } from "@/components/block-journey-client";
import type { StoneCategory } from "@/lib/stone-categories";
import {
  buildLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
  type BjMarbleTruckRow,
  type BjCutSessionSlabRow,
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

  const [freshR, reusedR, cutDoneR, doneCsbR, stoneTypesR, trucksR, cutSessionSlabsR] = await Promise.all([
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
    // Match the in-app /block-journey page (see comment there): slabs
    // that have moved past cut_done still count toward what each block
    // produced — otherwise the lineage card silently loses them once
    // carving picks them up. Same MT-B-246 class of bug.
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .in("status", POST_CUT_STATUSES),
    admin
      .from("cut_session_blocks")
      .select("block_id, status, updated_at")
      .eq("status", "done"),
    admin.from("stone_types").select("name, stone_category").order("name"),
    admin
      .from("marble_truck_entries")
      .select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at"),
    admin
      .from("cut_session_slabs")
      .select("slab_requirement_id, is_filler, cut_session_blocks!inner(block_id)"),
  ]);

  const freshBlocks = (freshR.data ?? []) as BjBlockRow[];
  const reusedBlocks = (reusedR.data ?? []) as BjBlockRow[];
  const cutDoneSlabs = (cutDoneR.data ?? []) as BjSlabRow[];
  const doneCsbs = (doneCsbR.data ?? []) as BjCsbRow[];
  const trucks = (trucksR.data ?? []) as BjMarbleTruckRow[];

  type RawCutSessionSlabRow = {
    slab_requirement_id: string;
    is_filler: boolean | null;
    cut_session_blocks:
      | { block_id: string }
      | { block_id: string }[]
      | null;
  };
  const cutSessionSlabsRaw = (cutSessionSlabsR.data ?? []) as RawCutSessionSlabRow[];
  const cutSessionSlabs: BjCutSessionSlabRow[] = [];
  for (const r of cutSessionSlabsRaw) {
    const csb = Array.isArray(r.cut_session_blocks)
      ? r.cut_session_blocks[0]
      : r.cut_session_blocks;
    if (!csb || !csb.block_id) continue;
    cutSessionSlabs.push({
      slab_requirement_id: r.slab_requirement_id,
      is_filler: r.is_filler ?? null,
      block_id: csb.block_id,
    });
  }

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
    cutSessionSlabs,
  );
  const profilesMap = await getProfilesMap();

  const stoneOptions = (stoneTypesR.data ?? [])
    .map((s: { name: string }) => s.name)
    .filter(Boolean);

  // Block Purchase entry — visible inside the dashboard peek iframe too,
  // but it'd break the modal if it navigated in place, so it pops out
  // into a new tab via target="_blank".
  const canSeePurchase =
    profile.role === "owner" || profile.role === "developer";

  return (
    <>
      {canSeePurchase && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 10,
          }}
        >
          <Link
            href="/blocks/purchase"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: "var(--gold-dark)",
              border: "1px solid var(--gold-dark)",
              borderRadius: 8,
              textDecoration: "none",
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            📦 Block Purchase
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.22)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              ↗ New tab
            </span>
          </Link>
        </div>
      )}
      <BlockJourneyClient
        lineages={lineages}
        profilesMap={profilesMap}
        stoneOptions={stoneOptions}
        stoneCategoryMap={stoneCategoryMap}
        initialMode={initialMode}
      />
    </>
  );
}
