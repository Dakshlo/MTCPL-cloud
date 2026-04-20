import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { AddBlockForm } from "./add-block-form";
import { MarbleTruckForm } from "./marble-truck-form";
import { BlockGrid } from "./block-grid";
import { BlockExport } from "./block-export";
import { generateNextCode } from "./utils";
import { yardLabel } from "@/lib/yards";
import type { StoneCategory } from "@/lib/stone-categories";

// Entry roles see only their own additions
const BLOCK_ENTRY_ROLES = ["block_entry", "block_slab_entry"] as const;

type SearchParams = Promise<{ cat?: string; marble_toast?: string; marble_error?: string }>;

export default async function BlocksPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "slab_entry", "block_entry"]);
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

  const [
    { data: blocks, error },
    { data: allIds },
    { data: consumed },
    { data: vendorRows },
    { data: stoneTypes },
    { data: openSlabs },
  ] = await Promise.all([
    blocksQuery,
    admin.from("blocks").select("id"),
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
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, priority")
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (error) throw new Error(error.message);

  const profilesMap = await getProfilesMap();

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
    if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
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
            padding: "14px 18px",
            background: "var(--surface)",
            border: "2px dashed var(--border)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Block Report</p>
            <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
              View, filter and sort all block records — including consumed, discarded, and active · Export to Excel
            </p>
          </div>
          <BlockExport />
        </div>
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
          openSlabs={openSlabs ?? []}
          stoneCategoryMap={stoneCategoryMap}
        />
      )}

      {/* Block Usage History — collapsible */}
      {consumedList.length > 0 && (
        <details style={{ marginTop: 40 }}>
          <summary style={{ cursor: "pointer", listStyle: "none", userSelect: "none" }}>
            <div
              className="section-heading"
              style={{
                marginTop: 0,
                display: "inline-flex",
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>Block History ({consumedList.length}) ▾</h2>
                <p className="muted" style={{ margin: "2px 0 0" }}>
                  Recently consumed blocks · click to expand
                </p>
              </div>
            </div>
          </summary>
          <div className="records-stack" style={{ marginTop: 12 }}>
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
        </details>
      )}
    </>
  );
}
