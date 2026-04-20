import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { approveBlockAction, rejectBlockAction, undoApproveAction } from "./actions";
import { RejectButton } from "./reject-button";
import { UndoApproveButton } from "./undo-approve-button";
import { CuttingTimer } from "./cutting-timer";
import { computeCutEfficiency } from "@/lib/cut-efficiency";
import { yardLabel, facilityOfYard, facilityLabel, FACILITIES, type Facility } from "@/lib/yards";
import { PrintReportButton } from "./print-report-button";

type Tab = "pending" | "in_progress" | "done";
type SearchParams = Promise<{ tab?: string }>;

type BlockRow = {
  id: string;
  status: string;
  block_id: string;
  restocked_block_id: string | null;
  layout: {
    blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
    placed?: Array<{ id: string; label?: string; temple?: string; sw?: number; sh?: number; sd?: number }>;
    biggest?: { l: number; w: number; h: number } | null;
  } | null;
  updated_at: string | null;
  cut_session_id: string;
  cut_sessions: { session_code: string; kerf_mm: number; planned_by: string | null } | null;
  cut_session_slabs: Array<{ slab_requirement_id: string }>;
};

function defaultTab(role: string): Tab {
  if (role === "team_head") return "pending";
  return "in_progress";
}

/** Split a list of cutting rows into { mtcpl: [...], riico: [...] } by each
 * block's yard. Preserves the input order within each facility. */
function splitRowsByFacility(rows: BlockRow[]): Record<Facility, BlockRow[]> {
  const out: Record<Facility, BlockRow[]> = { mtcpl: [], riico: [] };
  for (const r of rows) {
    out[facilityOfYard(r.layout?.blk?.yard)].push(r);
  }
  return out;
}

/** Small header strip that sits above each facility's rows. Same visual
 * language as the one used on the Block Inventory page so they feel linked. */
function FacilityHeader({ facility, count, compact = false }: { facility: Facility; count: number; compact?: boolean }) {
  const isRiico = facility === "riico";
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: compact ? "4px 0 2px" : "10px 0 6px",
      borderBottom: compact ? "1px dashed var(--border)" : "1px solid var(--border)",
      marginBottom: compact ? 6 : 10,
      marginTop: compact ? 4 : 8,
    }}>
      <span style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: compact ? "2px 8px" : "3px 10px",
        borderRadius: 4,
        background: isRiico ? "rgba(124,58,237,0.12)" : "rgba(184,115,51,0.12)",
        color: isRiico ? "#7c3aed" : "var(--gold-dark)",
        border: `1px solid ${isRiico ? "rgba(124,58,237,0.3)" : "rgba(184,115,51,0.3)"}`,
      }}>
        {facilityLabel(facility)}
      </span>
      <span style={{ fontSize: compact ? 11 : 12, color: "var(--muted)", fontWeight: 600 }}>
        {count} {count === 1 ? "block" : "blocks"}
      </span>
    </div>
  );
}

/** IST (Asia/Kolkata) midnight window for "today" — returns UTC ISO strings for DB range queries. */
function istTodayBounds() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  // Shift to IST wall-clock, floor to midnight, shift back to UTC
  const todayIstMidnightMs = Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return {
    todayStartIso: new Date(todayIstMidnightMs).toISOString(),
    tomorrowStartIso: new Date(todayIstMidnightMs + DAY_MS).toISOString(),
  };
}

export default async function CuttingPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const params = await searchParams;
  const activeTab: Tab = (params.tab as Tab) || defaultTab(profile.role);
  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { todayStartIso, tomorrowStartIso } = istTodayBounds();

  // Count per individual block status — "done" badge shows TODAY only
  const [
    { count: pendingCount },
    { count: inProgressCount },
    { count: doneTodayCount },
  ] = await Promise.all([
    supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_worker"),
    supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .in("status", ["cutting", "done_prompt"]),
    supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .eq("status", "done")
      .gte("updated_at", todayStartIso)
      .lt("updated_at", tomorrowStartIso),
  ]);

  let statusFilter: string[];
  if (activeTab === "pending") statusFilter = ["pending_worker"];
  else if (activeTab === "in_progress") statusFilter = ["cutting", "done_prompt"];
  else statusFilter = ["done", "rejected"];

  // Fetch urgent slab IDs to highlight blocks containing them
  const { data: urgentSlabData } = await supabase
    .from("slab_requirements")
    .select("id")
    .eq("priority", true)
    .in("status", ["open", "planned", "cutting"]);
  const urgentSlabIds = new Set((urgentSlabData ?? []).map(s => s.id));

  const { data: blocks } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, restocked_block_id, layout, updated_at, cut_session_id, cut_sessions(session_code, kerf_mm, planned_by), cut_session_slabs(slab_requirement_id)"
    )
    .in("status", statusFilter)
    .order("updated_at", { ascending: activeTab !== "done" })
    .limit(100);

  const allRows = (blocks ?? []) as unknown as BlockRow[];
  const rows = activeTab === "done" ? allRows.filter(b => b.status !== "rejected") : allRows;
  const rejectedRows = activeTab === "done" ? allRows.filter(b => b.status === "rejected") : [];

  // Split done rows into today vs earlier (based on updated_at falling in the IST "today" window)
  const todayRows = activeTab === "done"
    ? rows.filter(b => b.updated_at && b.updated_at >= todayStartIso && b.updated_at < tomorrowStartIso)
    : [];
  const earlierRows = activeTab === "done"
    ? rows.filter(b => !b.updated_at || b.updated_at < todayStartIso || b.updated_at >= tomorrowStartIso)
    : [];

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: "pending",     label: "Pending Approval", count: pendingCount },
    { key: "in_progress", label: "In Progress",      count: inProgressCount },
    { key: "done",        label: "Done today",        count: doneTodayCount },
  ];

  const emptyMessages: Record<Tab, string> = {
    pending:     "No blocks waiting for approval.",
    in_progress: "No blocks currently being cut.",
    done:        "No completed cuts yet.",
  };

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Cutting</h1>
          <p className="muted">
            Each block is handled independently — approve, cut, and record slabs one by one.
          </p>
        </div>
        <PrintReportButton />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          margin: "20px 0 0",
          borderBottom: "2px solid var(--border)",
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <a
              key={tab.key}
              href={`/cutting?tab=${tab.key}`}
              style={{
                textDecoration: "none",
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "var(--gold-dark)" : "var(--muted)",
                borderBottom: isActive
                  ? "2px solid var(--gold)"
                  : "2px solid transparent",
                marginBottom: -2,
                borderRadius: "4px 4px 0 0",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                gap: 7,
                transition: "color 0.15s",
              }}
            >
              {tab.label}
              {(tab.count ?? 0) > 0 && (
                <span
                  style={{
                    background: isActive ? "var(--gold)" : "var(--border)",
                    color: isActive ? "#fff" : "var(--muted)",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 7px",
                    minWidth: 20,
                    textAlign: "center",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      {/* Block cards */}
      <div className="records-stack" style={{ marginTop: 18 }}>
        {rows.length === 0 && rejectedRows.length === 0 && (
          <div className="banner">{emptyMessages[activeTab]}</div>
        )}

        {/* Done tab: "Today" heading */}
        {activeTab === "done" && (todayRows.length > 0 || earlierRows.length > 0) && (
          <div style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            margin: "4px 0 10px",
            paddingBottom: 6,
            borderBottom: "1px solid var(--border)",
          }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Today
              <span style={{ marginLeft: 8, fontWeight: 500, color: "var(--muted)", fontSize: 12 }}>
                · {doneTodayCount ?? 0} completed
              </span>
            </h3>
          </div>
        )}
        {activeTab === "done" && todayRows.length === 0 && earlierRows.length > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: "0 0 14px", padding: "8px 12px", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 6 }}>
            No cuts completed today yet.
          </p>
        )}

        {(() => {
          const source = activeTab === "done" ? todayRows : rows;
          const grouped = splitRowsByFacility(source);
          // Always render in a consistent order; skip sections that are empty.
          return FACILITIES.map((f) => {
            const list = grouped[f];
            if (list.length === 0) return null;
            return (
              <div key={`active-${f}`}>
                <FacilityHeader facility={f} count={list.length} />
                {list.map((block) => {
                  const blk = block.layout?.blk;
                  const placed = block.layout?.placed ?? [];
                  const slabCount = block.cut_session_slabs.length;
                  const isLive = block.status === "cutting";
                  const isUrgent = block.cut_session_slabs.some((s) => urgentSlabIds.has(s.slab_requirement_id));
                  const eff = computeCutEfficiency(blk, placed, block.layout?.biggest ?? null);

                  return (
                    <div className="plan-card" key={block.id} style={isUrgent ? { borderLeft: "4px solid #DC2626", background: "rgba(220,38,38,0.10)" } : {}}>
                <div
                  className="record-head"
                  style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}
                >
                  {/* Block identity + live dot */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {isLive && (
                      <span
                        className="live-dot"
                        title="Live — cutting in progress"
                        style={{ marginTop: 4 }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 15,
                        }}
                      >
                        {block.block_id}
                      </strong>
                      {isUrgent && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", background: "rgba(220,38,38,0.12)", padding: "2px 8px", borderRadius: 8, marginLeft: 6 }}>
                          ⚡ Urgent slab
                        </span>
                      )}
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                        {block.cut_sessions?.session_code}
                        {blk
                          ? ` · ${blk.stone} · ${yardLabel(blk.yard)} · ${blk.l} × ${blk.w} × ${blk.h} in`
                          : ""}
                        {block.cut_sessions?.kerf_mm
                          ? ` · Kerf ${block.cut_sessions.kerf_mm} mm`
                          : ""}
                      </p>
                      {block.cut_sessions?.planned_by && profilesMap[block.cut_sessions.planned_by] && (
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)" }}>
                          Plan by{" "}
                          <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                            {profilesMap[block.cut_sessions.planned_by]}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Slab count + timer + detail link */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    {block.updated_at && block.status === "pending_worker" && (
                      <CuttingTimer startedAt={block.updated_at} prefix="Pending from last" />
                    )}
                    {block.updated_at && (isLive || block.status === "done_prompt") && (
                      <CuttingTimer startedAt={block.updated_at} prefix="Cutting from last" />
                    )}
                    <span className="role-pill">
                      {slabCount} slab{slabCount !== 1 ? "s" : ""}
                    </span>
                    {eff && (
                      <span
                        title={`Slabs ${eff.slabPct}% · Restockable ${eff.restockPct}% · Waste ${Math.max(0, 100 - eff.slabPct - eff.restockPct)}%`}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontSize: 11, padding: "3px 8px", borderRadius: 12,
                          background: "var(--bg)", border: "1px solid var(--border)",
                          fontFamily: "ui-monospace, monospace", fontWeight: 600,
                          color: "var(--muted)",
                        }}
                      >
                        <span style={{ display: "inline-flex", width: 36, height: 5, borderRadius: 2, overflow: "hidden", background: "var(--border)" }}>
                          <span style={{ width: `${eff.slabPct}%`, background: "#15803d" }} />
                          <span style={{ width: `${eff.restockPct}%`, background: "#b45309" }} />
                          <span style={{ width: `${Math.max(0, 100 - eff.slabPct - eff.restockPct)}%`, background: "#b91c1c" }} />
                        </span>
                        <span style={{ color: "#15803d", fontWeight: 700 }}>{eff.slabPct}%</span>
                      </span>
                    )}
                    {(block.status === "pending_worker" || isLive || block.status === "done_prompt" || block.status === "done") && (
                      <Link
                        href={`/cutting/${block.id}/print`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          textDecoration: "none",
                          fontSize: 12,
                          padding: "4px 12px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--muted)",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}
                      >
                        🖨 Print
                      </Link>
                    )}
                    <Link
                      href={`/cutting/${block.id}`}
                      style={{
                        textDecoration: "none",
                        fontSize: 12,
                        padding: "4px 12px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text)",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      View →
                    </Link>
                  </div>
                </div>

                {/* Slab ID chips — include W×H×T so the owner can see the
                    size without opening the detail view. */}
                {placed.length > 0 && (
                  <div className="chip-row" style={{ marginTop: 8 }}>
                    {placed.map((s) => (
                      <span className="plan-chip" key={s.id}>
                        {s.id}
                        {(s.sw != null || s.sh != null || s.sd != null) && (
                          <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>
                            {s.sw ?? "—"}×{s.sh ?? "—"}×{s.sd ?? "—"}″
                          </span></>
                        )}
                        {s.temple ? ` · ${s.temple}` : ""}
                      </span>
                    ))}
                  </div>
                )}

                {/* Inline actions */}
                <div className="record-actions" style={{ marginTop: 12, gap: 8 }}>
                  {block.status === "pending_worker" && (
                    <>
                      <form action={approveBlockAction}>
                        <input
                          type="hidden"
                          name="session_block_id"
                          value={block.id}
                        />
                        <input
                          type="hidden"
                          name="session_id"
                          value={block.cut_session_id}
                        />
                        <button className="primary-button" type="submit">
                          Approve &amp; Start Cutting
                        </button>
                      </form>
                      <form action={rejectBlockAction}>
                        <input
                          type="hidden"
                          name="session_block_id"
                          value={block.id}
                        />
                        <input
                          type="hidden"
                          name="session_id"
                          value={block.cut_session_id}
                        />
                        <input
                          type="hidden"
                          name="block_id"
                          value={block.block_id}
                        />
                        <input
                          type="hidden"
                          name="slab_ids"
                          value={JSON.stringify(
                            block.cut_session_slabs.map(
                              (s) => s.slab_requirement_id
                            )
                          )}
                        />
                        <RejectButton />
                      </form>
                    </>
                  )}

                  {isLive && (
                    <>
                      <Link
                        href={`/cutting/${block.id}`}
                        className="primary-button"
                        style={{ textDecoration: "none" }}
                      >
                        Cutting Done →
                      </Link>
                      <form action={undoApproveAction}>
                        <input type="hidden" name="session_block_id" value={block.id} />
                        <input type="hidden" name="session_id" value={block.cut_session_id} />
                        <UndoApproveButton />
                      </form>
                    </>
                  )}

                  {block.status === "done_prompt" && (
                    <Link
                      href={`/cutting/${block.id}`}
                      className="primary-button"
                      style={{ textDecoration: "none" }}
                    >
                      Complete Slab Selection →
                    </Link>
                  )}

                  {block.status === "done" && (
                    <span
                      className="role-pill badge-available"
                      style={{ fontSize: 12 }}
                    >
                      ✓ Done
                      {block.restocked_block_id
                        ? ` · Restocked ${block.restocked_block_id.split(",").length} piece(s)`
                        : " · Block discarded"}
                      {block.updated_at
                        ? ` · ${new Date(block.updated_at).toLocaleDateString(
                            "en-IN",
                            { day: "numeric", month: "short" }
                          )}`
                        : ""}
                    </span>
                  )}

                  {block.status === "rejected" && (
                    <span className="role-pill badge-discarded">
                      Rejected — block returned to inventory
                    </span>
                  )}
                </div>
              </div>
                  );
                })}
              </div>
            );
          });
        })()}

        {/* Done tab: "Earlier" collapsed section for previous days */}
        {activeTab === "done" && earlierRows.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary style={{
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "8px 4px",
              userSelect: "none",
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderTop: "1px solid var(--border)",
              paddingTop: 14,
            }}>
              <span style={{ fontSize: 11 }}>▶</span>
              Earlier — {earlierRows.length} block{earlierRows.length !== 1 ? "s" : ""}
            </summary>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {(() => {
                const grouped = splitRowsByFacility(earlierRows);
                return FACILITIES.map((f) => {
                  const list = grouped[f];
                  if (list.length === 0) return null;
                  return (
                    <div key={`earlier-${f}`}>
                      <FacilityHeader facility={f} count={list.length} compact />
                      {list.map((block) => {
                        const blk = block.layout?.blk;
                        const placed = block.layout?.placed ?? [];
                        const slabCount = block.cut_session_slabs.length;
                        return (
                          <div className="plan-card" key={block.id} style={{ marginBottom: 8 }}>
                            <div className="record-head" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
                                  {block.block_id}
                                </strong>
                                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                                  {block.cut_sessions?.session_code}
                                  {blk ? ` · ${blk.stone} · ${yardLabel(blk.yard)} · ${blk.l} × ${blk.w} × ${blk.h} in` : ""}
                                  {block.cut_sessions?.kerf_mm ? ` · Kerf ${block.cut_sessions.kerf_mm} mm` : ""}
                                </p>
                                {block.cut_sessions?.planned_by && profilesMap[block.cut_sessions.planned_by] && (
                                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)" }}>
                                    Plan by <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                                      {profilesMap[block.cut_sessions.planned_by]}
                                    </span>
                                  </p>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <span className="role-pill">{slabCount} slab{slabCount !== 1 ? "s" : ""}</span>
                                <Link
                                  href={`/cutting/${block.id}/print`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    textDecoration: "none", fontSize: 12, padding: "4px 12px",
                                    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
                                    color: "var(--muted)", fontWeight: 500, whiteSpace: "nowrap",
                                  }}
                                >
                                  🖨 Print
                                </Link>
                                <Link
                                  href={`/cutting/${block.id}`}
                                  style={{
                                    textDecoration: "none", fontSize: 12, padding: "4px 12px",
                                    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
                                    color: "var(--text)", fontWeight: 500, whiteSpace: "nowrap",
                                  }}
                                >
                                  View →
                                </Link>
                              </div>
                            </div>
                            {placed.length > 0 && (
                              <div className="chip-row" style={{ marginTop: 8 }}>
                                {placed.map((s) => (
                                  <span className="plan-chip" key={s.id}>
                                    {s.id}
                                    {(s.sw != null || s.sh != null || s.sd != null) && (
                                      <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>
                                        {s.sw ?? "—"}×{s.sh ?? "—"}×{s.sd ?? "—"}″
                                      </span></>
                                    )}
                                    {s.temple ? ` · ${s.temple}` : ""}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="record-actions" style={{ marginTop: 12, gap: 8 }}>
                              <span className="role-pill badge-available" style={{ fontSize: 12 }}>
                                ✓ Done
                                {block.restocked_block_id
                                  ? ` · Restocked ${block.restocked_block_id.split(",").length} piece(s)`
                                  : " · Block discarded"}
                                {block.updated_at
                                  ? ` · ${new Date(block.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                                  : ""}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </details>
        )}

        {/* Rejected blocks — collapsed dropdown at bottom of Done tab */}
        {activeTab === "done" && rejectedRows.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "8px 4px",
              userSelect: "none",
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{ fontSize: 11 }}>▶</span>
              {rejectedRows.length} Rejected block{rejectedRows.length !== 1 ? "s" : ""}
            </summary>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {(() => {
                const grouped = splitRowsByFacility(rejectedRows);
                return FACILITIES.map((f) => {
                  const list = grouped[f];
                  if (list.length === 0) return null;
                  return (
                    <div key={`rejected-${f}`}>
                      <FacilityHeader facility={f} count={list.length} compact />
                      {list.map((block) => {
                        const blk = block.layout?.blk;
                        const slabCount = block.cut_session_slabs.length;
                        return (
                          <div key={block.id} className="plan-card" style={{ opacity: 0.65, marginBottom: 8 }}>
                            <div className="record-head" style={{ flexWrap: "wrap", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
                                  {block.block_id}
                                </strong>
                                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                                  {block.cut_sessions?.session_code}
                                  {blk ? ` · ${blk.stone} · ${yardLabel(blk.yard)}` : ""}
                                  {block.updated_at ? ` · ${new Date(block.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                                </p>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <span className="role-pill">{slabCount} slab{slabCount !== 1 ? "s" : ""}</span>
                                <Link href={`/cutting/${block.id}`} style={{ textDecoration: "none", fontSize: 12, padding: "4px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontWeight: 500 }}>
                                  View →
                                </Link>
                              </div>
                            </div>
                            <div style={{ marginTop: 8 }}>
                              <span className="role-pill badge-discarded" style={{ fontSize: 11 }}>
                                Rejected — block returned to inventory
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
