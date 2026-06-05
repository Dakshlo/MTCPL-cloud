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

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";

// Daksh May 2026 round 3 — force a fresh server render on every
// page load. Without this, a marble manual-cut → block-journey
// click within ~30s could land on a cached version that still
// shows "0.00 CFT yield" because the cutDoneSlabs fetch happened
// before the cut was recorded. force-dynamic guarantees the user
// always sees the current cut state immediately after the action
// redirects them.
export const dynamic = "force-dynamic";
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

  // Paginated slab_requirements fetch — Block Journey was silently
  // truncating to PostgREST's 1000-row default page, which dropped any
  // slab past the first 1000 rows. Once a block's slabs had progressed
  // beyond row 1000 (e.g. MT-B-223 / ASTA-0005), the lineage card lost
  // them and showed "cut recorded but no slabs linked". Same fix the
  // cutting picker already uses — walk 1000-row pages up to 50000.
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
    // Block Journey shows what each block "produced" — counting only
    // status='cut_done' meant slabs disappeared from the lineage as
    // soon as the carving team picked them up, making the recovery
    // % drop for any block whose slabs had progressed beyond cut_done.
    // Include the full post-cut lifecycle here so the lineage
    // continues to credit the parent block for every slab that came
    // out of it, regardless of where the slab is now. Pagination
    // is required — see fetchAllPostCutSlabs comment above.
    fetchAllPostCutSlabs(),
    admin
      .from("cut_session_blocks")
      .select("block_id, status, updated_at")
      .eq("status", "done"),
    admin.from("stone_types").select("name, stone_category").order("name"),
    admin
      .from("marble_truck_entries")
      .select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at"),
    // Cut session slab links — used by buildLineages to mark each
    // slab as "planned" / "filler" / "extra" on the lineage card.
    // Joined to cut_session_blocks so we know which physical
    // block_id each link is bound to.
    admin
      .from("cut_session_slabs")
      .select("slab_requirement_id, is_filler, cut_session_blocks!inner(block_id)"),
  ]);

  const freshBlocks = (freshR.data ?? []) as BjBlockRow[];
  const reusedBlocks = (reusedR.data ?? []) as BjBlockRow[];
  const cutDoneSlabs = (cutDoneR.data ?? []) as BjSlabRow[];
  const doneCsbs = (doneCsbR.data ?? []) as BjCsbRow[];
  const trucks = (trucksR.data ?? []) as BjMarbleTruckRow[];

  // Flatten the join so each cut_session_slabs row carries the
  // block_id of its parent cut_session_block. PostgREST returns the
  // join as either an object or an array depending on the
  // foreign-key direction; normalise to a single block_id string.
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
    cutSessionSlabs,
  );
  const profilesMap = await getProfilesMap();

  const stoneOptions = (stoneTypesR.data ?? [])
    .map((s: { name: string }) => s.name)
    .filter(Boolean);

  // Block Purchase report — sister "intake" view to the efficiency
  // report on this page. Strictly owner/developer (never Naresh or
  // Rajesh — procurement spend is sensitive).
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
              Owner
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
