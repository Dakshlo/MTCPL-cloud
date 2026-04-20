/**
 * List-view cutting report — prints a compact overview of every Pending
 * Approval + In Progress block across the selected facility. Unlike the
 * per-block print page (which prints cutting plans with 3D/2D layouts),
 * this is a brief list that fits several blocks per page for the owner
 * to glance at.
 *
 * Each row shows:
 *   - block ID, session code, stone, yard, block dimensions
 *   - every placed slab with its ID, W×H×T dimensions and temple
 *
 * Query params:
 *   facility = "mtcpl" | "riico" | "both"  (default "both")
 *
 * Always filters to statuses: pending_worker, cutting, done_prompt.
 */

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { facilityOfYard, facilityLabel, yardLabel, FACILITIES, YARDS_BY_FACILITY, type Facility } from "@/lib/yards";
import { PrintBtn } from "../[id]/print/print-btn";

type SearchParams = Promise<{ facility?: string }>;

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw?: number;
  sh?: number;
  sd?: number;
};

type BlockRow = {
  id: string;
  block_id: string;
  status: string;
  updated_at: string | null;
  cut_session_id: string;
  layout: {
    blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
    placed?: PlacedSlab[];
  } | null;
  cut_sessions: { session_code: string; kerf_mm: number; planned_by: string | null } | null;
  cut_session_slabs: Array<{ slab_requirement_id: string }>;
};

function prettyFacilityScope(f: "mtcpl" | "riico" | "both"): string {
  if (f === "both") return "All Facilities (MTCPL + RIICO)";
  return facilityLabel(f as Facility);
}

/** "53×30×29″" — prefers the slab layout dims, falls back to em-dashes. */
function slabDimsStr(s: PlacedSlab): string {
  const parts = [s.sw, s.sh, s.sd].map(v => (v != null ? String(v) : "—"));
  return `${parts[0]}×${parts[1]}×${parts[2]}″`;
}

export default async function CuttingListPrintPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAuth(["owner", "team_head", "cutting_operator"]);
  const { facility: facilityParam } = await searchParams;
  const facility: "mtcpl" | "riico" | "both" =
    facilityParam === "mtcpl" || facilityParam === "riico" ? facilityParam : "both";

  const supabase = createAdminSupabaseClient();

  const { data: blocks, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, block_id, status, updated_at, cut_session_id, layout, " +
      "cut_sessions(session_code, kerf_mm, planned_by), " +
      "cut_session_slabs(slab_requirement_id)"
    )
    .in("status", ["pending_worker", "cutting", "done_prompt"])
    .order("status", { ascending: true })
    .order("updated_at", { ascending: true });

  if (error) {
    notFound();
  }

  const profilesMap = await getProfilesMap();
  const allRows = (blocks ?? []) as unknown as BlockRow[];

  // Filter by facility
  const rows = allRows.filter(r => {
    if (facility === "both") return true;
    const yard = r.layout?.blk?.yard;
    const f = facilityOfYard(yard);
    return f === facility;
  });

  // Highlight blocks with urgent slabs
  const { data: urgentSlabData } = await supabase
    .from("slab_requirements")
    .select("id")
    .eq("priority", true)
    .in("status", ["open", "planned", "cutting"]);
  const urgentSlabIds = new Set((urgentSlabData ?? []).map(s => s.id));

  // Group by facility → status for clean sections
  const grouped: Record<Facility, { pending: BlockRow[]; inProgress: BlockRow[] }> = {
    mtcpl: { pending: [], inProgress: [] },
    riico: { pending: [], inProgress: [] },
  };
  for (const r of rows) {
    const f = facilityOfYard(r.layout?.blk?.yard);
    if (r.status === "pending_worker") grouped[f].pending.push(r);
    else grouped[f].inProgress.push(r);
  }

  const totalBlocks = rows.length;
  const totalPending = rows.filter(r => r.status === "pending_worker").length;
  const totalInProgress = totalBlocks - totalPending;
  const totalSlabs = rows.reduce((sum, r) => sum + (r.layout?.placed?.length ?? 0), 0);

  const printDate = new Date().toLocaleString("en-IN", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // Figure out which facility sections to render
  const scopeFacilities: Facility[] = facility === "both"
    ? [...FACILITIES]
    : [facility];

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
               font-size: 12px; color: #1a1a1a; background: #f0f0f0; }

        .print-wrap { max-width: 900px; margin: 0 auto; background: #fff;
                      padding: 24px 28px 32px; }

        .screen-bar { background: #1a1a1a; color: #fff; padding: 10px 28px;
                      display: flex; align-items: center; justify-content: space-between;
                      gap: 12px; max-width: 900px; margin: 0 auto; }
        .screen-bar-title { font-size: 13px; color: rgba(255,255,255,0.8); }
        .print-action-btn { background: #b87333; color: #fff; border: none;
                            padding: 8px 22px; border-radius: 6px; font-size: 13px;
                            font-weight: 600; cursor: pointer; letter-spacing: 0.02em; }
        .print-action-btn:hover { background: #a06428; }

        .doc-eyebrow { font-size: 10px; font-weight: 700; color: #888;
                       text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
        .doc-title { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 3px; }
        .doc-sub { font-size: 12px; color: #555; }
        .doc-date { font-size: 10px; color: #888; text-align: right; line-height: 1.6; }

        /* Summary tiles */
        .summary { display: grid; grid-template-columns: repeat(4, 1fr);
                   gap: 10px; margin: 16px 0 22px; }
        .tile { padding: 10px 12px; background: #fafafa;
                border: 1px solid #ddd; border-radius: 6px; }
        .tile-label { font-size: 9px; font-weight: 700; color: #999;
                      text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 3px; }
        .tile-value { font-size: 18px; font-weight: 700; color: #1a1a1a;
                      font-family: ui-monospace, monospace; }

        /* Facility / status headings */
        .facility-head { display: flex; align-items: center; gap: 10px;
                         margin: 20px 0 8px; padding-bottom: 6px;
                         border-bottom: 2px solid #1a1a1a; }
        .facility-pill { font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
                         padding: 3px 10px; border-radius: 4px; }
        .facility-pill.mtcpl { background: rgba(184,115,51,0.12);
                               color: #a06428;
                               border: 1px solid rgba(184,115,51,0.3); }
        .facility-pill.riico { background: rgba(124,58,237,0.12);
                               color: #6d28d9;
                               border: 1px solid rgba(124,58,237,0.3); }
        .facility-scope { font-size: 10px; color: #999; font-weight: 500; }

        .status-head { font-size: 10px; font-weight: 700; color: #666;
                       text-transform: uppercase; letter-spacing: 0.08em;
                       margin: 14px 0 6px; padding-bottom: 3px;
                       border-bottom: 1px dashed #ccc; }

        /* Block row */
        .block-row { border: 1px solid #ddd; border-radius: 6px;
                     padding: 10px 12px; margin-bottom: 8px;
                     page-break-inside: avoid; background: #fff; }
        .block-row.urgent { border-left: 4px solid #dc2626;
                            background: rgba(220,38,38,0.04); }
        .block-header { display: flex; justify-content: space-between;
                        flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
        .block-id { font-family: ui-monospace, monospace; font-size: 14px;
                    font-weight: 700; color: #1a1a1a; }
        .block-urgent-badge { font-size: 9px; font-weight: 700; color: #dc2626;
                              background: rgba(220,38,38,0.1); padding: 1px 7px;
                              border-radius: 3px; margin-left: 6px; }
        .block-meta { font-size: 11px; color: #666; line-height: 1.5; }
        .block-meta strong { color: #333; }

        /* Slab list within a block */
        .slab-list { margin-top: 6px; padding-top: 6px;
                     border-top: 1px solid #eee;
                     display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
                     gap: 4px 10px; }
        .slab-item { font-size: 11px; color: #444; line-height: 1.4;
                     font-family: ui-monospace, monospace; }
        .slab-item .slab-id { color: #1a1a1a; font-weight: 700; }
        .slab-item .slab-dims { color: #666; }
        .slab-item .slab-temple { font-family: -apple-system, Arial, sans-serif;
                                  color: #888; }

        .empty { padding: 14px; text-align: center; color: #999;
                 font-size: 12px; background: #fafafa;
                 border: 1px dashed #ddd; border-radius: 6px; }

        .doc-footer { margin-top: 24px; padding-top: 10px;
                      border-top: 1px solid #e0e0e0;
                      display: flex; justify-content: space-between;
                      font-size: 10px; color: #aaa; }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          @page { margin: 10mm; }
        }

        @media screen { body { padding: 0; } }
      `}</style>

      {/* Screen-only header bar with Print button */}
      <div className="screen-bar">
        <span className="screen-bar-title">
          Cutting Report — {prettyFacilityScope(facility)} · {totalBlocks} block{totalBlocks !== 1 ? "s" : ""}
        </span>
        <PrintBtn />
      </div>

      <div className="print-wrap">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div className="doc-eyebrow">MTCPL · Cutting Report</div>
            <div className="doc-title">In Progress + Pending Approval</div>
            <div className="doc-sub">{prettyFacilityScope(facility)}</div>
          </div>
          <div className="doc-date">
            <div>Printed: {printDate}</div>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="summary">
          <div className="tile">
            <div className="tile-label">Total Blocks</div>
            <div className="tile-value">{totalBlocks}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Pending Approval</div>
            <div className="tile-value">{totalPending}</div>
          </div>
          <div className="tile">
            <div className="tile-label">In Progress</div>
            <div className="tile-value">{totalInProgress}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Total Slabs</div>
            <div className="tile-value">{totalSlabs}</div>
          </div>
        </div>

        {totalBlocks === 0 && (
          <div className="empty">
            No blocks currently in progress or awaiting approval for {prettyFacilityScope(facility)}.
          </div>
        )}

        {/* Facility sections */}
        {scopeFacilities.map(f => {
          const g = grouped[f];
          const count = g.pending.length + g.inProgress.length;
          if (count === 0) return null;
          return (
            <section key={f}>
              <div className="facility-head">
                <span className={`facility-pill ${f}`}>{facilityLabel(f)}</span>
                <span style={{ fontSize: 11, color: "#555", fontWeight: 600 }}>
                  {count} block{count !== 1 ? "s" : ""}
                </span>
                <span className="facility-scope">
                  · Yards {YARDS_BY_FACILITY[f].join(", ")}
                </span>
              </div>

              {g.pending.length > 0 && (
                <>
                  <div className="status-head">Pending Approval — {g.pending.length}</div>
                  {g.pending.map(b => (
                    <BlockRowView
                      key={b.id} block={b}
                      profilesMap={profilesMap}
                      isUrgent={b.cut_session_slabs.some(s => urgentSlabIds.has(s.slab_requirement_id))}
                    />
                  ))}
                </>
              )}

              {g.inProgress.length > 0 && (
                <>
                  <div className="status-head">In Progress — {g.inProgress.length}</div>
                  {g.inProgress.map(b => (
                    <BlockRowView
                      key={b.id} block={b}
                      profilesMap={profilesMap}
                      isUrgent={b.cut_session_slabs.some(s => urgentSlabIds.has(s.slab_requirement_id))}
                    />
                  ))}
                </>
              )}
            </section>
          );
        })}

        <div className="doc-footer">
          <span>MTCPL · Cutting Report · {prettyFacilityScope(facility)}</span>
          <span>{totalBlocks} block{totalBlocks !== 1 ? "s" : ""} · {totalSlabs} slab{totalSlabs !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </>
  );
}

function BlockRowView({
  block, profilesMap, isUrgent,
}: {
  block: BlockRow;
  profilesMap: Record<string, string>;
  isUrgent: boolean;
}) {
  const blk = block.layout?.blk;
  const placed = block.layout?.placed ?? [];
  const session = block.cut_sessions;
  const plannerName = session?.planned_by ? (profilesMap[session.planned_by] ?? null) : null;

  return (
    <div className={`block-row${isUrgent ? " urgent" : ""}`}>
      <div className="block-header">
        <div>
          <span className="block-id">{block.block_id}</span>
          {isUrgent && <span className="block-urgent-badge">⚡ URGENT</span>}
        </div>
        <div style={{ fontSize: 10, color: "#888", fontFamily: "ui-monospace, monospace" }}>
          {session?.session_code ?? "—"}
        </div>
      </div>

      <div className="block-meta">
        {blk ? (
          <>
            <strong>{blk.stone}</strong> · {yardLabel(blk.yard)}
            {" · "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {blk.l}×{blk.w}×{blk.h}″
            </span>
          </>
        ) : "Block data unavailable"}
        {session?.kerf_mm ? <> · Kerf {session.kerf_mm} mm</> : null}
        {plannerName ? <> · Plan by <strong>{plannerName}</strong></> : null}
      </div>

      {placed.length > 0 ? (
        <div className="slab-list">
          {placed.map(s => (
            <div className="slab-item" key={s.id}>
              <span className="slab-id">{s.id}</span>{" "}
              <span className="slab-dims">{slabDimsStr(s)}</span>
              {s.temple ? <> <span className="slab-temple">· {s.temple}</span></> : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 11, color: "#999", fontStyle: "italic" }}>
          No slabs in this plan.
        </div>
      )}
    </div>
  );
}
