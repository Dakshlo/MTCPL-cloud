import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { AddBlockForm } from "./add-block-form";
import { MarbleTruckForm } from "./marble-truck-form";
import { BlockGrid } from "./block-grid";
import { BlockSearchBar } from "./block-search-bar";
import { MarbleCutLog } from "./marble-cut-log";
import { undoMarbleCutAction } from "./actions";
import { PeekIframe } from "@/components/peek-iframe";
import { PeekSection } from "@/components/peek-section";
import { generateNextCode } from "./utils";
import { yardLabel } from "@/lib/yards";
import type { StoneCategory } from "@/lib/stone-categories";

// Entry roles see only their own additions
const BLOCK_ENTRY_ROLES = ["block_entry", "block_slab_entry"] as const;

type SearchParams = Promise<{ cat?: string; marble_toast?: string; marble_error?: string }>;

export default async function BlocksPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "slab_entry", "block_entry"]);
  const { cat: catParam, marble_toast: marbleToast, marble_error: marbleError } = await searchParams;
  // Default landing = Sandstone (the everyday tab). "All" and "Marble"
  // need an explicit URL param. Users who want the combined view can
  // either click "All" in the tab strip or hit /blocks?cat=all.
  const activeCat: "all" | "sandstone" | "marble" =
    catParam === "all" || catParam === "marble" ? catParam : "sandstone";

  const admin = createAdminSupabaseClient();
  const isEntryRole = (BLOCK_ENTRY_ROLES as readonly string[]).includes(profile.role);

  let blocksQuery = admin
    .from("blocks")
    .select(
      "id, stone, yard, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, quality, truck_no, vendor_name, bill_no, created_at, created_by",
    )
    .in("status", ["available", "reserved"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (isEntryRole) blocksQuery = blocksQuery.eq("created_by", profile.id);

  // Paginated open-slab fetch — Supabase's PostgREST caps single .select()
  // calls at 1000 rows. Without paging, the manual-cut slab picker only
  // sees the first 1000 of currently-open slabs (sorted priority+newest);
  // older slabs (e.g. ROHTAK-0017 and below) silently fall off the list.
  // Same fix pattern used in /slabs/page.tsx.
  type OpenSlabRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    quality: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    priority?: boolean;
  };
  async function fetchAllOpenSlabs(): Promise<OpenSlabRow[]> {
    const PAGE = 1000;
    const out: OpenSlabRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error: pageErr } = await admin
        .from("slab_requirements")
        .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, priority")
        .eq("status", "open")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (pageErr) throw new Error(pageErr.message);
      if (!data || data.length === 0) break;
      // Coerce nullable priority → optional boolean to match downstream type
      for (const row of data as Array<OpenSlabRow & { priority?: boolean | null }>) {
        out.push({ ...row, priority: row.priority ?? undefined });
      }
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [
    { data: blocks, error },
    { data: allIds },
    { data: consumed },
    { data: vendorRows },
    { data: stoneTypes },
    openSlabs,
  ] = await Promise.all([
    blocksQuery,
    // Explicit high limit — same reason as in the slab page: Supabase's
    // default .select() cap is 1000 rows, which once exceeded causes the
    // Add Block form to suggest a block-code that's already in use.
    admin.from("blocks").select("id").limit(100000),
    admin
      .from("blocks")
      .select("id, stone, yard, length_ft, width_ft, height_ft, tonnes, updated_at")
      .eq("status", "consumed")
      .order("updated_at", { ascending: false })
      .limit(30),
    // Block suppliers are saved as vendor_type = 'block_vendor' in prod.
    // Carving vendors (CNC / Manual) don't belong in this dropdown —
    // filter them out so operators don't accidentally pick a carving
    // vendor as the block's supplier. Accept 'Outsource' too for
    // compat with older rows if anyone added a vendor that way.
    admin
      .from("vendors")
      .select("name")
      .eq("is_active", true)
      .in("vendor_type", ["block_vendor", "Outsource"])
      .order("name"),
    admin
      .from("stone_types")
      .select("id, name, color_top, color_front, color_side, stone_category")
      .order("sort_order")
      .order("name"),
    fetchAllOpenSlabs(),
  ]);

  if (error) throw new Error(error.message);

  const profilesMap = await getProfilesMap();

  // ── Marble cut log ────────────────────────────────────────────────
  // We define "cut" inclusively: any block that's either
  //   (a) status='consumed' (officially marked done), OR
  //   (b) referenced by at least one slab_requirements.source_block_id
  //       (i.e. slabs were physically generated from it, even if the
  //        block.status didn't get flipped to 'consumed')
  // Either signal proves cutting happened — and we want every such
  // block to surface in the log so manual-cut bypass blocks aren't
  // silently dropped because of a missing status flip.
  // Paginated to dodge the 1000-row PostgREST cap.
  type ConsumedRow = {
    id: string;
    stone: string | null;
    yard: number;
    length_ft: number | null;
    width_ft: number | null;
    height_ft: number | null;
    tonnes: number | string | null;
    truck_no: string | null;
    vendor_name: string | null;
    updated_at: string | null;
    updated_by: string | null;
  };
  async function fetchConsumedBlocks(): Promise<ConsumedRow[]> {
    const PAGE = 1000;
    const out: ConsumedRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error: pageErr } = await admin
        .from("blocks")
        .select(
          "id, stone, yard, length_ft, width_ft, height_ft, tonnes, truck_no, vendor_name, updated_at, updated_by",
        )
        .eq("status", "consumed")
        .order("updated_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (pageErr) throw new Error(pageErr.message);
      if (!data || data.length === 0) break;
      out.push(...(data as ConsumedRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  // Fetch every distinct source_block_id from slab_requirements —
  // these are blocks that had slabs generated from them. Any such
  // block was cut, regardless of what its current status is.
  async function fetchAllSourceBlockIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const PAGE = 1000;
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error: pageErr } = await admin
        .from("slab_requirements")
        .select("source_block_id")
        .not("source_block_id", "is", null)
        .range(offset, offset + PAGE - 1);
      if (pageErr) throw new Error(pageErr.message);
      if (!data || data.length === 0) break;
      for (const r of data as { source_block_id: string | null }[]) {
        if (r.source_block_id) ids.add(r.source_block_id);
      }
      if (data.length < PAGE) break;
    }
    return ids;
  }

  // Fetch a list of block records by id (any status). Used to fill in
  // blocks that have slabs linked but aren't in the consumed set.
  async function fetchBlocksByIds(blockIds: string[]): Promise<ConsumedRow[]> {
    if (blockIds.length === 0) return [];
    const PAGE = 500;
    const out: ConsumedRow[] = [];
    for (let i = 0; i < blockIds.length; i += PAGE) {
      const chunk = blockIds.slice(i, i + PAGE);
      const { data, error: pageErr } = await admin
        .from("blocks")
        .select(
          "id, stone, yard, length_ft, width_ft, height_ft, tonnes, truck_no, vendor_name, updated_at, updated_by",
        )
        .in("id", chunk);
      if (pageErr) throw new Error(pageErr.message);
      if (data) out.push(...(data as ConsumedRow[]));
    }
    return out;
  }

  type CutSlabRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    status: string;
    source_block_id: string | null;
  };
  async function fetchSlabsForBlocks(blockIds: string[]): Promise<CutSlabRow[]> {
    if (blockIds.length === 0) return [];
    const CHUNK = 500; // safe size for the .in() URL list
    const PAGE = 1000; // PostgREST default row cap per request
    const out: CutSlabRow[] = [];
    // Chunk block-id list to keep .in() query strings safe.
    // No status filter: we want to surface every slab linked to a
    // cut block — including ones still in 'planned' / 'open' if the
    // operator generated them but hasn't moved them along yet.
    // The component already shows status per slab.
    //
    // Daksh May 2026 round 2 — the per-chunk query needs its OWN
    // pagination via .range(). Without it, PostgREST silently caps
    // each request at 1000 rows. Once cumulative slab count crosses
    // that, blocks at the tail of the chunk lost slabs randomly
    // (e.g. MT-B-380 showed "1 cut" in the Marble Cutting Log even
    // though six slabs existed; Total Ready Sizes + the labels page
    // both read slab_requirements with their own pagination and
    // showed all six). Order by id so the pagination is deterministic
    // and pages don't shuffle rows across requests.
    for (let i = 0; i < blockIds.length; i += CHUNK) {
      const chunk = blockIds.slice(i, i + CHUNK);
      for (let offset = 0; offset < 100_000; offset += PAGE) {
        const { data, error: pageErr } = await admin
          .from("slab_requirements")
          .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, source_block_id")
          .in("source_block_id", chunk)
          .order("id")
          .range(offset, offset + PAGE - 1);
        if (pageErr) throw new Error(pageErr.message);
        if (!data || data.length === 0) break;
        out.push(...(data as CutSlabRow[]));
        if (data.length < PAGE) break;
      }
    }
    return out;
  }

  // Build the inclusive cut-block universe.
  const consumedBlocks = await fetchConsumedBlocks();
  const linkedBlockIds = await fetchAllSourceBlockIds();
  const consumedIdSet = new Set(consumedBlocks.map((b) => b.id));
  const missingIds = [...linkedBlockIds].filter((id) => !consumedIdSet.has(id));
  const extraBlocks = await fetchBlocksByIds(missingIds);
  const allConsumed: ConsumedRow[] = [...consumedBlocks, ...extraBlocks];

  const consumedSlabs = await fetchSlabsForBlocks(allConsumed.map((b) => b.id));
  const slabsByBlock = new Map<string, CutSlabRow[]>();
  for (const s of consumedSlabs) {
    if (!s.source_block_id) continue;
    const arr = slabsByBlock.get(s.source_block_id) ?? [];
    arr.push(s);
    slabsByBlock.set(s.source_block_id, arr);
  }

  const canEdit = ["developer", "owner", "team_head", "block_slab_entry", "block_entry"].includes(profile.role);
  const canViewReport = ["developer", "owner", "team_head"].includes(profile.role);
  const allBlocks = blocks ?? [];
  const consumedList = consumed ?? [];
  const vendors = (vendorRows ?? []).map((v) => v.name);
  const suggestedId = generateNextCode((allIds ?? []).map((r) => r.id));
  const stoneList = stoneTypes ?? [];

  // Build a stone-name → category map so the rest of the page (block grid,
  // filters) can decide sandstone-vs-marble without re-querying.
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneList) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[s.name] = cat === "marble" ? "marble" : "sandstone";
  }
  const marbleStoneList = stoneList.filter(
    (s) => (s as { stone_category?: string }).stone_category === "marble",
  );
  const sandstoneStoneList = stoneList.filter(
    (s) => (s as { stone_category?: string }).stone_category !== "marble",
  );

  // Split blocks by category for counts + filtering
  function categoryOf(stone: string | null | undefined): StoneCategory {
    if (!stone) return "sandstone";
    return stoneCategoryMap[stone] ?? "sandstone";
  }
  const sandstoneBlocks = allBlocks.filter((b) => categoryOf(b.stone) === "sandstone");
  const marbleBlocks = allBlocks.filter((b) => categoryOf(b.stone) === "marble");

  // Build the marble-cut log feed — one entry per consumed marble
  // block with its cut slabs and cutter info. Client-side filterable
  // by date / stone (yellow vs white) inside the modal.
  const marbleCutLog = allConsumed
    .filter((b) => categoryOf(b.stone) === "marble")
    .map((b) => ({
      id: b.id,
      stone: b.stone ?? "Unknown",
      yard: b.yard,
      length_ft: b.length_ft,
      width_ft: b.width_ft,
      height_ft: b.height_ft,
      tonnes: b.tonnes != null ? Number(b.tonnes) : null,
      truck_no: b.truck_no,
      vendor_name: b.vendor_name,
      cut_at: b.updated_at,
      cut_by_name: b.updated_by ? profilesMap[b.updated_by] ?? null : null,
      slabs: (slabsByBlock.get(b.id) ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        temple: s.temple,
        length_ft: Number(s.length_ft),
        width_ft: Number(s.width_ft),
        thickness_ft: Number(s.thickness_ft),
        status: s.status,
      })),
    }));

  const blockList =
    activeCat === "sandstone" ? sandstoneBlocks : activeCat === "marble" ? marbleBlocks : allBlocks;
  const totalBlocks = blockList.length;

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    if (isToday) return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Blocks Inventory</h1>
          <p className="muted">Available and reserved blocks ready for planning.</p>
        </div>
      </div>

      {/* Toast / error banners from marble truck form submissions */}
      {marbleToast && (
        <div
          className="banner"
          style={{
            background: "rgba(22,101,52,0.08)",
            borderColor: "rgba(22,101,52,0.3)",
            color: "#15803d",
          }}
        >
          {marbleToast}
        </div>
      )}
      {marbleError && (
        <div
          className="banner"
          style={{
            background: "rgba(185,28,28,0.08)",
            borderColor: "rgba(185,28,28,0.3)",
            color: "#b91c1c",
          }}
        >
          {marbleError}
        </div>
      )}

      {/* Category tabs — neutral by default, gold fill when selected. Makes
          it obvious at a glance which category you're viewing. */}
      {marbleStoneList.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            margin: "20px 0 14px",
            flexWrap: "wrap",
          }}
        >
          {([
            { key: "all", label: "All", count: allBlocks.length },
            { key: "sandstone", label: "Sandstone", count: sandstoneBlocks.length },
            { key: "marble", label: "🗿 Marble", count: marbleBlocks.length },
          ] as const).map((tab) => {
            const isActive = tab.key === activeCat;
            return (
              <a
                key={tab.key}
                href={tab.key === "sandstone" ? "/blocks" : `/blocks?cat=${tab.key}`}
                style={{
                  textDecoration: "none",
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  color: isActive ? "#1a1a1a" : "var(--muted)",
                  background: isActive ? "#E8C572" : "transparent",
                  border: `1.5px solid ${isActive ? "#b87333" : "var(--border)"}`,
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  transition: "all 0.12s",
                  boxShadow: isActive ? "0 2px 8px rgba(232,197,114,0.35)" : "none",
                }}
              >
                {tab.label}
                <span
                  style={{
                    background: isActive ? "#1a1a1a" : "var(--border)",
                    color: isActive ? "#E8C572" : "var(--muted)",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "1px 9px",
                    minWidth: 24,
                    textAlign: "center",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {tab.count}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {/* Add form — flips based on active tab */}
      {canEdit && activeCat === "marble" ? (
        <MarbleTruckForm marbleStones={marbleStoneList} vendors={vendors} suggestedId={suggestedId} />
      ) : canEdit ? (
        <AddBlockForm
          suggestedId={suggestedId}
          vendors={vendors}
          stoneTypes={sandstoneStoneList.length > 0 ? sandstoneStoneList : stoneList}
        />
      ) : null}

      {canViewReport && (
        <div
          style={{
            margin: "28px 0 4px",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          {/* Block Report — opens in a center-peek iframe over /embed/blocks/report
              so the team doesn't lose their place on /blocks. The
              standalone /blocks/report route still works (sidebar +
              back button) for direct nav. */}
          <div style={{ flex: "1 1 320px", display: "flex" }}>
            <PeekIframe
              url="/embed/blocks/report"
              triggerIcon="📊"
              triggerLabel="Block Report"
              triggerSubtitle="View, filter and sort all block records — including consumed, discarded, and active · Export to Excel"
              modalTitle="Block Report"
              triggerStyle={{ flex: 1 }}
            />
          </div>
          {/* Marble Cutting Log only relevant on the Marble or All tabs —
              hide it on Sandstone so the Block Report stretches full-width. */}
          {(activeCat === "marble" || activeCat === "all") && (
            <MarbleCutLog entries={marbleCutLog} undoAction={undoMarbleCutAction} />
          )}
        </div>
      )}

      {/* Search bar — same UX as the slab page. Click to expand a
          center-peek modal that searches across id, stone, yard,
          vendor, truck no, dimensions, status. Click outside / Esc
          closes. Click a result → scrolls + highlights the matching
          card in the BlockGrid below. */}
      {blockList.length > 0 && (
        <BlockSearchBar blocks={blockList} />
      )}

      <div className="section-heading">
        <div>
          <h2>
            {totalBlocks} Blocks
            {activeCat !== "all" && (
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginLeft: 8 }}>
                ({activeCat === "marble" ? "Marble" : "Sandstone"} only)
              </span>
            )}
          </h2>
          <p>
            {isEntryRole
              ? "Showing only blocks you added · Click to edit"
              : "Click any card to edit · Esc to close"}
          </p>
        </div>
      </div>

      {blockList.length === 0 ? (
        <div className="banner">
          {isEntryRole
            ? "You haven't added any blocks yet. Add your first block above."
            : activeCat === "marble"
              ? "No marble blocks yet. Log a marble truck above."
              : "No blocks yet. Add your first block above."}
        </div>
      ) : (
        <BlockGrid
          blocks={blockList}
          canEdit={canEdit}
          vendors={vendors}
          profilesMap={profilesMap}
          stoneTypes={stoneList}
          openSlabs={openSlabs}
          stoneCategoryMap={stoneCategoryMap}
        />
      )}

      {/* Block Usage History — center-peek modal so the page stays
          short. Same content as before, just hosted in the modal. */}
      {consumedList.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <PeekSection
            icon="📜"
            title="Block History"
            count={consumedList.length}
            subtitle="Recently consumed blocks — click to view the full list."
            modalMaxWidth={1100}
          >
            <div className="records-stack">
              {consumedList.map((blk) => {
                const isMarbleBlock = stoneCategoryMap[blk.stone ?? ""] === "marble";
                const cft =
                  !isMarbleBlock && blk.length_ft && blk.width_ft && blk.height_ft
                    ? ((Number(blk.length_ft) * Number(blk.width_ft) * Number(blk.height_ft)) / 1728).toFixed(2)
                    : null;
                const tonnes =
                  isMarbleBlock && blk.tonnes != null ? Number(blk.tonnes).toFixed(3) : null;
                return (
                  <div className="record-card compact-record" key={blk.id}>
                    <div className="record-head">
                      <div>
                        <strong style={{ fontFamily: "ui-monospace, monospace" }}>{blk.id}</strong>
                        <p className="muted" style={{ margin: "2px 0 0" }}>
                          {blk.stone} · {yardLabel(blk.yard)}
                          {cft
                            ? ` · ${Number(blk.length_ft)} × ${Number(blk.width_ft)} × ${Number(blk.height_ft)} in · ${cft} CFT`
                            : tonnes
                              ? ` · ${tonnes} T (marble)`
                              : ""}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="role-pill badge-consumed">cut &amp; consumed</span>
                        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          Used: {fmtDate(blk.updated_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </PeekSection>
        </div>
      )}
    </>
  );
}
