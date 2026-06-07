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

  // Paginated slab_requirements fetch — MUST mirror /block-journey's
  // fetchAllPostCutSlabs exactly. This embed (the dashboard peek) used a
  // single un-paginated query, which silently truncated to PostgREST's
  // 1000-row default page: every cut slab past row 1000 was dropped, so
  // recovery was undercounted and a block with 3 slabs could show only 1.
  // The standalone /block-journey page already paginated this query — the
  // two copies had drifted, which is exactly why the peek (owner / dev /
  // senior_incharge) disagreed with the full page (team_head). Walk
  // 1000-row pages up to 50000; also select cut_source_kind so manual-cut
  // marble lineages compute correctly (same as the standalone page).
  async function fetchAllPostCutSlabs() {
    const PAGE = 1000;
    const MAX = 50000;
    const out: unknown[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status, cut_source_kind")
        .not("source_block_id", "is", null)
        .in("status", POST_CUT_STATUSES)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return { data: out, error: null as null };
  }

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
    // Paginated to match /block-journey exactly — see fetchAllPostCutSlabs
    // above. (Was a single un-paginated query here, which capped at 1000
    // rows and made the dashboard peek undercount recovery vs the full
    // page.) Slabs that moved past cut_done still count toward what each
    // block produced (POST_CUT_STATUSES), same MT-B-246 fix.
    fetchAllPostCutSlabs(),
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
            // Daksh June 2026 — open in the CURRENT window, not a new
            // tab. This link lives inside the dashboard peek iframe, so
            // a plain navigation would only swap the iframe contents;
            // target="_top" breaks out and navigates the whole tab.
            target="_top"
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
