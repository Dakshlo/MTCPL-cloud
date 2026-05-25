import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { approveBlockAction, rejectBlockAction, startCuttingAction, undoApproveAction } from "./actions";
import {
  addOperatorAction,
  approveBlockWithOperatorAction,
  approveBlockSkipOperatorAction,
  assignOperatorOnlyAction,
} from "./operator-actions";
import { RejectButton } from "./reject-button";
import { UndoApproveButton } from "./undo-approve-button";
import { CuttingTimer } from "./cutting-timer";
import { computeCutEfficiency, computeActualCutEfficiency } from "@/lib/cut-efficiency";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { yardLabel, facilityOfYard, facilityLabel, FACILITIES, type Facility } from "@/lib/yards";
import { PrintReportButton } from "./print-report-button";
import { SelectionProvider } from "./selection-context";
import { BlockSelector } from "./block-selector";
import { CuttingHistorySearchBar, type HistoryRow } from "./cutting-history-search-bar";
import { PendingApprovalActions } from "./pending-approval-actions";
import { canApproveCuts, canManageOperators } from "@/lib/cutting-permissions";

type Tab = "pending" | "waiting" | "in_progress" | "done";
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
  /** Per-cutter sequence number assigned when block enters 'cutting'.
   *  NULL when not in cutting state. Used as a short verbal id ("Cutter #3"). */
  cutting_seq?: number | null;
  /** Donor block needs reprint after a slab was claimed away. */
  needs_reprint?: boolean | null;
  reprint_reason?: string | null;
  /** Cutter operator assignment — added by team_head when sending the
   *  block to Waiting to Cut (or pre-tagged from Pending Approval).
   *  Joined operators row for display. Both nullable: a block may
   *  have been approved before the operator workflow existed. */
  operator_id?: string | null;
  operators?: { id: string; name: string } | null;
  /** Mig 027 audit trail — who signed off the cutting-done submission
   *  + when. Surfaced as "Approved by NAME · DATE" on the Done card so
   *  the team can see at a glance which auditor cleared each block.
   *  Multiple people approve (Naresh / Rajesh / Parth / Mafat / dev /
   *  owner) so the name matters. */
  approved_by?: string | null;
  approved_at?: string | null;
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
  // Audit-side roles (carving_head, crosscheck) need read access so the
  // tabs they're approving from the queue match what they see here.
  // Same widening as /cutting/[id] and /cutting/approvals.
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "team_head",
    "senior_incharge",
    "carving_head",
    "crosscheck",
    "cutting_operator",
  ]);
  const params = await searchParams;
  const activeTab: Tab = (params.tab as Tab) || defaultTab(profile.role);
  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();
  const showOperatorPicker = canManageOperators(profile);

  // Active operator picklist for the modal. Loaded once per page
  // render, cheap join: small lookup table, indexed on is_active.
  const { data: operatorRows } = showOperatorPicker
    ? await supabase
        .from("operators")
        .select("id, name")
        .eq("is_active", true)
        .order("name")
    : { data: [] };
  const operatorOptions = (operatorRows ?? []) as Array<{ id: string; name: string }>;

  const { todayStartIso, tomorrowStartIso } = istTodayBounds();

  // Count per individual block status — "done" badge shows TODAY only.
  // In-Approval count (migration 027) is scoped by role:
  //   - approvers (dev / owner / team_head with can_approve_cuts) → site-wide count
  //   - everyone else (non-approver team_head submitters like Alkesh /
  //     Paresh, plus any cutting_operator) → only their own submissions
  // Drives the "👀 In Approval (N)" banner shown above In Progress.
  // The "person who fills Cutting Done" role is team_head in this
  // shop (per Daksh) — operators submit FROM team_head accounts.
  const isApprover = canApproveCuts(profile);
  const wantsOwnApprovalsOnly = !isApprover;
  const [
    { count: pendingCount },
    { count: waitingCount },
    { count: inProgressCount },
    { count: doneTodayCount },
    { count: inApprovalCount },
  ] = await Promise.all([
    supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_worker"),
    supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_cut"),
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
    wantsOwnApprovalsOnly
      ? supabase
          .from("cut_session_blocks")
          .select("*", { count: "exact", head: true })
          .in("status", ["awaiting_approval", "awaiting_cutter_edit"])
          .eq("submitted_for_approval_by", profile.id)
      : supabase
          .from("cut_session_blocks")
          .select("*", { count: "exact", head: true })
          .in("status", ["awaiting_approval", "awaiting_cutter_edit"]),
  ]);

  let statusFilter: string[];
  if (activeTab === "pending") statusFilter = ["pending_worker"];
  else if (activeTab === "waiting") statusFilter = ["pending_cut"];
  else if (activeTab === "in_progress") statusFilter = ["cutting", "done_prompt"];
  else statusFilter = ["done", "rejected"];

  // Fetch urgent slab IDs to highlight blocks containing them
  const { data: urgentSlabData } = await supabase
    .from("slab_requirements")
    .select("id")
    .eq("priority", true)
    .in("status", ["open", "planned", "cutting"]);
  const urgentSlabIds = new Set((urgentSlabData ?? []).map(s => s.id));

  // Paginated fetch — Supabase's PostgREST caps single .select() calls at
  // 1000 rows. The previous .limit(100) silently dropped older Done /
  // Rejected blocks once history grew past ~100 rows, which is why
  // operators reported "block-64 isn't showing in Earlier". On the
  // active tabs (Pending / Waiting / In Progress) we still cap at 200
  // because those should never grow that long; the Done tab needs
  // unlimited history so the Earlier + Rejected sections (and the
  // upcoming search bar) can find anything the team has ever cut.
  type CutBlockRow = BlockRow;
  async function fetchAllBlocks(): Promise<CutBlockRow[]> {
    const PAGE = 1000;
    const ascending = activeTab !== "done";
    const out: CutBlockRow[] = [];
    // Active tabs cap at 200 (more than enough); done tab walks the
    // full history so search can reach anything.
    const maxRows = activeTab === "done" ? 50000 : 200;
    for (let offset = 0; offset < maxRows; offset += PAGE) {
      const upper = Math.min(offset + PAGE - 1, maxRows - 1);
      const { data, error } = await supabase
        .from("cut_session_blocks")
        .select(
          "id, status, block_id, restocked_block_id, layout, updated_at, cut_session_id, cutting_seq, needs_reprint, reprint_reason, operator_id, approved_by, approved_at, operators(id, name), cut_sessions(session_code, kerf_mm, planned_by), cut_session_slabs(slab_requirement_id)"
        )
        .in("status", statusFilter)
        .order("updated_at", { ascending })
        .range(offset, upper);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as unknown as CutBlockRow[]));
      if (data.length < PAGE) break;
      if (out.length >= maxRows) break;
    }
    return out;
  }
  const allRowsRaw = await fetchAllBlocks();
  // Float blocks with needs_reprint=true to the top of the active
  // tabs so the donor operator sees the "PLAN MODIFIED" surface
  // first when they open /cutting. Within each priority bucket the
  // existing updated_at ordering is preserved (stable sort).
  // Done tab is exempt — those blocks are already finished and
  // the reprint flag would have been cleared by finishBlockAction.
  const allRows = activeTab === "done"
    ? allRowsRaw
    : [...allRowsRaw].sort((a, b) => {
        const aP = a.needs_reprint ? 1 : 0;
        const bP = b.needs_reprint ? 1 : 0;
        return bP - aP; // needs_reprint=true first
      });
  const rows = activeTab === "done" ? allRows.filter(b => b.status !== "rejected") : allRows;
  const rejectedRows = activeTab === "done" ? allRows.filter(b => b.status === "rejected") : [];

  // For DONE rows, enrich with the real post-cut data: which slabs were
  // actually cut (from slab_requirements where source_block_id = our
  // parent block id), and which remainder blocks got restocked (real
  // dimensions looked up from the blocks table via the comma-separated
  // restocked_block_id field). The efficiency bar on pending/in-progress
  // cards keeps using the planner's projection — only done cards flip to
  // real numbers.
  type ActualSlab = { sw: number; sh: number; sd: number };
  type ActualSlabRow = {
    id: string;
    label: string | null;
    temple: string | null;
    sw: number;
    sh: number;
    sd: number;
    /** Migration 035 tag — used to render a purple TRANSFER badge on
     *  the Done-tab chip when the slab came from another block's
     *  plan, vs the orange "+ added" badge for inventory extras. */
    cut_source_kind: "planned" | "extra" | "transferred" | null;
  };
  type ActualRemainder = { id: string; l: number; w: number; h: number; status: string };
  const actualSlabsByParent = new Map<string, ActualSlab[]>();
  /** Full slab rows (id + label + temple + dims) per parent block —
   *  used to render chips on Done Today cards so manual additions
   *  surface alongside planned ones. */
  const actualSlabRowsByParent = new Map<string, ActualSlabRow[]>();
  const actualRemaindersByParent = new Map<string, ActualRemainder[]>();

  if (activeTab === "done" && rows.length > 0) {
    const parentBlockIds = [...new Set(rows.map(r => r.block_id).filter(Boolean))];

    // Actually cut slabs for these blocks.
    //
    // Bug fix (Daksh, MT-B-246): the previous query used
    //   .eq("status", "cut_done")
    // which only returned slabs still sitting at the cut_done stage.
    // As soon as a slab was assigned to carving / dispatched / rejected
    // its status flipped and it vanished from the Done-card chip row —
    // so a block that produced 8 slabs over time would look like it
    // produced 3 because the others had already moved downstream.
    //
    // POST_CUT_STATUSES is the shared constant for "slab was physically
    // produced from a block" — keeps every consumer (this page,
    // /slabs/ready, /block-journey, the exports, the AI tool) in sync.
    const { data: realSlabRows } = await supabase
      .from("slab_requirements")
      .select("id, label, temple, length_ft, width_ft, thickness_ft, source_block_id, status, cut_source_kind")
      .in("source_block_id", parentBlockIds)
      .in("status", POST_CUT_STATUSES);
    for (const s of realSlabRows ?? []) {
      if (!s.source_block_id) continue;
      const sw = Number(s.length_ft);
      const sh = Number(s.width_ft);
      const sd = Number(s.thickness_ft);
      const list = actualSlabsByParent.get(s.source_block_id) ?? [];
      list.push({ sw, sh, sd });
      actualSlabsByParent.set(s.source_block_id, list);

      const rowList = actualSlabRowsByParent.get(s.source_block_id) ?? [];
      rowList.push({
        id: s.id,
        label: s.label ?? null,
        temple: s.temple ?? null,
        sw,
        sh,
        sd,
        cut_source_kind: (s as { cut_source_kind?: string | null }).cut_source_kind as
          | "planned" | "extra" | "transferred" | null
          ?? null,
      });
      actualSlabRowsByParent.set(s.source_block_id, rowList);
    }

    // Restocked remainder blocks for these rows
    const restockedIds: string[] = [];
    for (const r of rows) {
      if (!r.restocked_block_id) continue;
      for (const id of r.restocked_block_id.split(",").map(s => s.trim()).filter(Boolean)) {
        restockedIds.push(id);
      }
    }
    if (restockedIds.length > 0) {
      const { data: realRemBlocks } = await supabase
        .from("blocks")
        .select("id, length_ft, width_ft, height_ft, status")
        .in("id", restockedIds);
      const byId = new Map<string, ActualRemainder>();
      for (const b of realRemBlocks ?? []) {
        byId.set(b.id, {
          id: b.id,
          l: Number(b.length_ft),
          w: Number(b.width_ft),
          h: Number(b.height_ft),
          status: b.status as string,
        });
      }
      for (const row of rows) {
        if (!row.restocked_block_id) continue;
        const ids = row.restocked_block_id.split(",").map(s => s.trim()).filter(Boolean);
        const rems = ids.map(id => byId.get(id)).filter((x): x is ActualRemainder => !!x);
        if (rems.length > 0) actualRemaindersByParent.set(row.block_id, rems);
      }
    }
  }

  // Split done rows into today vs earlier (based on updated_at falling in the IST "today" window)
  // Daksh May 2026 — explicit sort on both buckets (latest cut first)
  // so the order is bulletproof regardless of DB-side ordering.
  // earlierRows was perceived as "random" because the block IDs (MT-B-NNN)
  // don't follow cut order; sorting by updated_at DESC keeps it
  // chronological from the user's POV.
  const sortLatestFirst = (a: CutBlockRow, b: CutBlockRow) => {
    const av = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bv = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bv - av;
  };
  const todayRows = activeTab === "done"
    ? rows
        .filter(b => b.updated_at && b.updated_at >= todayStartIso && b.updated_at < tomorrowStartIso)
        .slice()
        .sort(sortLatestFirst)
    : [];
  const earlierRows = activeTab === "done"
    ? rows
        .filter(b => !b.updated_at || b.updated_at < todayStartIso || b.updated_at >= tomorrowStartIso)
        .slice()
        .sort(sortLatestFirst)
    : [];

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: "pending",     label: "Pending Approval", count: pendingCount },
    { key: "waiting",     label: "Waiting to Cut",   count: waitingCount },
    { key: "in_progress", label: "In Progress",      count: inProgressCount },
    { key: "done",        label: "Done today",       count: doneTodayCount },
  ];

  const emptyMessages: Record<Tab, string> = {
    pending:     "No blocks waiting for approval.",
    waiting:     "No blocks waiting to cut. Approved blocks land here before cutting starts.",
    in_progress: "No blocks currently being cut.",
    done:        "No completed cuts yet.",
  };

  return (
    <SelectionProvider>
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Cutting</h1>
          <p className="muted">
            Each block is handled independently — approve, cut, and record slabs one by one.
          </p>
        </div>
        <PrintReportButton tab={activeTab} />
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
        {/* Cutting Audit banner (migration 027) — always visible on the
            In Progress tab so cutters always have a clickable entry
            into the audit queue. Two visual states:
              - count > 0: prominent gold styling, count badge, "Review →"
              - count = 0: dimmed neutral styling, "Queue empty"
            Audience-aware copy:
              - Approvers (dev / owner / Rajesh) → full site count.
              - Cutting submitters (team_head Alkesh / Paresh,
                cutting_operator) → only their own pending submissions.
            The top-bar "✓ Cutting Audit" button is approver-only;
            this banner is the cutter's always-on doorway into the
            same audit queue. */}
        {activeTab === "in_progress" && (() => {
          const count = inApprovalCount ?? 0;
          const hasAny = count > 0;
          return (
            <Link
              href="/cutting/approvals"
              style={{
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                marginBottom: 14,
                background: hasAny ? "rgba(232,197,114,0.14)" : "var(--surface)",
                border: hasAny ? "1.5px solid var(--gold)" : "1px dashed var(--border)",
                borderLeft: hasAny ? "5px solid var(--gold-dark)" : "5px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 13,
              }}
            >
              <span style={{ fontSize: 16 }}>{hasAny ? "👀" : "✓"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: hasAny ? "var(--gold-dark)" : "var(--muted)" }}>
                  Cutting Audit
                  {hasAny ? ` (${count})` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  {hasAny
                    ? isApprover
                      ? "Review the cutter's Cutting Done submissions before they commit."
                      : wantsOwnApprovalsOnly
                        ? "Your Cutting Done submissions waiting for approval. Check status or edit if sent back."
                        : "Cutting Done submissions waiting for approval."
                    : isApprover
                      ? "Audit queue is empty — no submissions waiting."
                      : "Your submitted cuts will appear here after you press Done — review status or edit if sent back."}
                </div>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: hasAny ? "var(--gold-dark)" : "var(--muted)",
                  padding: "4px 10px",
                  background: "var(--bg)",
                  border: `1px solid ${hasAny ? "var(--gold)" : "var(--border)"}`,
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {hasAny ? "Review →" : "Open →"}
              </span>
            </Link>
          );
        })()}

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
                  const isLive = block.status === "cutting";
                  const isDoneStatus = block.status === "done";
                  // For pending/in-progress: show the planned count.
                  // For done: show the REAL cut count (which includes
                  // any slabs the operator manually added from inventory
                  // during the Cutting-Done flow). Falls back to the
                  // planned count if real data didn't come back.
                  const realRowCount = isDoneStatus
                    ? actualSlabRowsByParent.get(block.block_id)?.length ?? 0
                    : 0;
                  const slabCount =
                    isDoneStatus && realRowCount > 0 ? realRowCount : block.cut_session_slabs.length;
                  // For done blocks: how many of the actual cut slabs were
                  // added manually from inventory during the cutting-done
                  // flow (i.e. not in the original cut_session_slabs plan).
                  // Used to show a "+N added" hint next to the slab count
                  // pill so the team head can see at a glance that the
                  // operator pulled extras off the open-slabs shelf.
                  const manualAddedCount = (() => {
                    if (!isDoneStatus) return 0;
                    const realRows = actualSlabRowsByParent.get(block.block_id);
                    if (!realRows || realRows.length === 0) return 0;
                    const plannedIdSet = new Set(
                      block.cut_session_slabs.map((s) => s.slab_requirement_id),
                    );
                    return realRows.filter((s) => !plannedIdSet.has(s.id)).length;
                  })();
                  const isUrgent = block.cut_session_slabs.some((s) => urgentSlabIds.has(s.slab_requirement_id));
                  // Done blocks: use REAL post-cut data (actually-cut slabs
                  // + actually-restocked blocks). For any slab data the
                  // query didn't return (e.g. older cuts where
                  // source_block_id wasn't set on the planned slab, or
                  // rows blocked by some legacy constraint), fall back
                  // to the planner's `placed` list so the bar still
                  // reflects the cut rather than silently dropping to
                  // the projection. Pending/in-progress stays on the
                  // projection — that's still the best guess until the
                  // cut is finished.
                  const actualSlabs = isDoneStatus ? actualSlabsByParent.get(block.block_id) : undefined;
                  const actualRemainders = isDoneStatus ? actualRemaindersByParent.get(block.block_id) : undefined;
                  const slabsForEff = (actualSlabs && actualSlabs.length > 0)
                    ? actualSlabs
                    : placed.map((p) => ({ sw: Number(p.sw ?? 0), sh: Number(p.sh ?? 0), sd: Number(p.sd ?? 0) }));
                  const eff = isDoneStatus
                    ? computeActualCutEfficiency(blk, slabsForEff, actualRemainders ?? [])
                    : computeCutEfficiency(blk, placed, block.layout?.biggest ?? null);
                  const useActual = isDoneStatus && ((actualSlabs?.length ?? 0) > 0 || (actualRemainders?.length ?? 0) > 0);

                  return (
                    <div
                      className="plan-card"
                      key={block.id}
                      style={
                        block.needs_reprint
                          ? {
                              borderLeft: "6px solid #dc2626",
                              background: "rgba(220,38,38,0.07)",
                              boxShadow: "0 2px 10px rgba(220,38,38,0.12)",
                            }
                          : isUrgent
                            ? { borderLeft: "4px solid #DC2626", background: "rgba(220,38,38,0.10)" }
                            : {}
                      }
                    >
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
                    <BlockSelector id={block.id} />
                    {isLive && (
                      <span
                        className="live-dot"
                        title="Live — cutting in progress"
                        style={{ marginTop: 4 }}
                      />
                    )}
                    {/* Cutter sequence badge — visible only on cutting
                     *  blocks that have a seq assigned. Prefixed with M
                     *  (MTCPL) or R (RIICO) so an operator can say "M5"
                     *  verbally and everyone knows which facility. The
                     *  prefix is derived from the block's yard, NOT
                     *  stored separately — a single integer per facility. */}
                    {isLive && typeof block.cutting_seq === "number" && (() => {
                      const fac = facilityOfYard(block.layout?.blk?.yard);
                      const prefix = fac === "riico" ? "R" : "M";
                      return (
                        <span
                          title={`${prefix}${block.cutting_seq} — short reference for this ${fac.toUpperCase()} block while it's being cut`}
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            fontFamily: "ui-monospace, monospace",
                            color: "#fff",
                            background: fac === "riico" ? "#7c3aed" : "var(--gold-dark)",
                            padding: "3px 9px",
                            borderRadius: 4,
                            letterSpacing: "0.02em",
                            marginTop: 1,
                            flexShrink: 0,
                            lineHeight: 1.4,
                          }}
                        >
                          {prefix}{block.cutting_seq}
                        </span>
                      );
                    })()}
                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 15,
                        }}
                      >
                        {block.block_id}
                      </strong>
                      {/* Reprint warning — donor block had a slab claimed
                       *  away. Visible on this card so the operator sees
                       *  it from the list, before clicking into detail. */}
                      {block.needs_reprint && (
                        <span
                          title={block.reprint_reason ?? ""}
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: "#fff",
                            background: "#dc2626",
                            border: "1px solid #b91c1c",
                            padding: "3px 10px",
                            borderRadius: 4,
                            letterSpacing: "0.05em",
                            marginLeft: 8,
                            boxShadow: "0 2px 6px rgba(220,38,38,0.30)",
                          }}
                        >
                          🚨 REPRINT NEEDED
                        </span>
                      )}
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
                      {/* Operator pill — visible to everyone once
                          assigned. Tag stays through Waiting / In
                          Progress / Done so the team always knows
                          who handled this block. */}
                      {block.operators?.name && (
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)" }}>
                          👷 Operator{" "}
                          <span style={{
                            color: "#15803d",
                            fontWeight: 700,
                            background: "rgba(22,101,52,0.10)",
                            padding: "1px 7px",
                            borderRadius: 4,
                          }}>
                            {block.operators.name}
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
                    <span
                      className="role-pill"
                      title={
                        manualAddedCount > 0
                          ? `${slabCount - manualAddedCount} planned + ${manualAddedCount} added from inventory during cutting`
                          : undefined
                      }
                    >
                      {slabCount} slab{slabCount !== 1 ? "s" : ""}
                      {manualAddedCount > 0 && (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#b45309",
                          background: "rgba(180,83,9,0.14)",
                          padding: "1px 6px",
                          borderRadius: 4,
                          letterSpacing: "0.04em",
                        }}>
                          +{manualAddedCount} added
                        </span>
                      )}
                    </span>
                    {eff && (
                      <span
                        title={`${isDoneStatus && actualSlabs ? "Actual" : "Projected"}: Slabs ${eff.slabPct}% · Restockable ${eff.restockPct}% · Waste ${Math.max(0, 100 - eff.slabPct - eff.restockPct)}%`}
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
                    {(
                      block.status === "pending_worker" ||
                      block.status === "pending_cut" ||
                      isLive ||
                      block.status === "done_prompt" ||
                      block.status === "done"
                    ) && (
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
                    {/* Daksh May 2026 — Slab Labels button surfaced
                        on the outer card so the team can print
                        without first opening View. Only relevant
                        once the cut is done (labels = post-cut
                        stencilling reference). */}
                    {(block.status === "done_prompt" || block.status === "done") && (
                      <Link
                        href={`/cutting/${block.id}/labels`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          textDecoration: "none",
                          fontSize: 12,
                          padding: "4px 12px",
                          background: "#fffbeb",
                          border: "1px solid #d97706",
                          borderRadius: 6,
                          color: "#92400e",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                        title="Print slab IDs to stencil on the physical slabs"
                      >
                        🏷 Labels
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
                    size without opening the detail view.

                    On DONE cards we flip from the planner's `placed`
                    projection to the REAL cut slabs from
                    slab_requirements. That way any slab the operator
                    manually added from inventory during the
                    Cutting-Done flow shows up here too — not just the
                    originals from the cut session. Manual additions
                    are tagged with a small "+ added" badge so the team
                    can see at a glance what was an unplanned add.

                    Pending / waiting / in-progress cards keep using
                    `placed` (the projection) — that's still the best
                    forward-looking view until the cut finishes. */}
                {(() => {
                  const realRows = isDoneStatus ? actualSlabRowsByParent.get(block.block_id) : undefined;
                  if (isDoneStatus && realRows && realRows.length > 0) {
                    // Anything in the real cut list that wasn't in the
                    // original cut_session_slabs is a manual addition.
                    // Migration 035's cut_source_kind distinguishes
                    // 'transferred' (claimed from another block's plan)
                    // from 'extra' (pulled off open inventory).
                    const plannedIds = new Set(block.cut_session_slabs.map((s) => s.slab_requirement_id));
                    const isTransfer = (s: ActualSlabRow) => s.cut_source_kind === "transferred";
                    const isExtra = (s: ActualSlabRow) =>
                      !plannedIds.has(s.id) && s.cut_source_kind !== "transferred";
                    const extraCount = realRows.filter(isExtra).length;
                    const transferCount = realRows.filter(isTransfer).length;
                    return (
                      <>
                        <div className="chip-row" style={{ marginTop: 8 }}>
                          {realRows.map((s) => {
                            const transfer = isTransfer(s);
                            const extra = isExtra(s);
                            const isManual = transfer || extra;
                            const chipStyle = transfer
                              ? {
                                  background: "rgba(124,58,237,0.10)",
                                  border: "1px solid rgba(124,58,237,0.45)",
                                  color: "var(--text)",
                                }
                              : extra
                                ? {
                                    background: "rgba(120,53,15,0.12)",
                                    border: "1px solid rgba(180,83,9,0.45)",
                                    color: "var(--text)",
                                  }
                                : undefined;
                            return (
                              <span
                                className="plan-chip"
                                key={s.id}
                                style={chipStyle}
                                title={
                                  transfer
                                    ? "Transferred from another block's plan during Cutting Done — that block had to reprint"
                                    : extra
                                      ? "Added from open inventory during Cutting Done — not in original plan"
                                      : undefined
                                }
                              >
                                {s.id}
                                {(s.sw != null || s.sh != null || s.sd != null) && (
                                  <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>
                                    {s.sw ?? "—"}×{s.sh ?? "—"}×{s.sd ?? "—"}″
                                  </span></>
                                )}
                                {s.temple ? ` · ${s.temple}` : ""}
                                {isManual && (
                                  <span style={{
                                    marginLeft: 6,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    letterSpacing: "0.05em",
                                    color: transfer ? "#6d28d9" : "#b45309",
                                    textTransform: "uppercase",
                                  }}>
                                    {transfer ? "↔ transfer" : "+ added"}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                        {(extraCount > 0 || transferCount > 0) && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                            {extraCount > 0 && `${extraCount} slab${extraCount === 1 ? "" : "s"} added from inventory`}
                            {extraCount > 0 && transferCount > 0 && " · "}
                            {transferCount > 0 && `${transferCount} slab${transferCount === 1 ? "" : "s"} transferred from another block`}
                          </div>
                        )}
                      </>
                    );
                  }
                  // Pre-done (or done with no real-slab data) → planner projection
                  if (placed.length === 0) return null;
                  return (
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
                  );
                })()}

                {/* Restocked remainder pieces — shown on done cards with
                    real dimensions + each piece's current status so the
                    owner can see at a glance what came out of this block. */}
                {isDoneStatus && actualRemainders && actualRemainders.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 5,
                    }}>
                      ♻ Restocked {actualRemainders.length} piece{actualRemainders.length !== 1 ? "s" : ""}
                    </div>
                    <div className="chip-row">
                      {actualRemainders.map(r => {
                        const cft = ((r.l * r.w * r.h) / 1728).toFixed(2);
                        const stillAvailable = r.status === "available";
                        return (
                          <Link
                            key={r.id}
                            href={`/blocks/report?block=${encodeURIComponent(r.id)}`}
                            className="plan-chip"
                            style={{
                              textDecoration: "none",
                              background: stillAvailable ? "rgba(22,101,52,0.12)" : "rgba(255,255,255,0.04)",
                              border: `1px solid ${stillAvailable ? "rgba(22,101,52,0.35)" : "var(--border)"}`,
                              color: stillAvailable ? "var(--text)" : "var(--muted)",
                              fontFamily: "ui-monospace, monospace",
                            }}
                            title={`${r.id} · ${r.l}×${r.w}×${r.h} in · ${cft} CFT · ${stillAvailable ? "available" : r.status}`}
                          >
                            {r.id}
                            {" · "}
                            <span>{r.l}×{r.w}×{r.h}″</span>
                            {" · "}
                            <span style={{ fontSize: 10, fontWeight: 600, color: stillAvailable ? "#15803d" : "var(--muted)" }}>
                              {stillAvailable ? "available" : r.status}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Inline actions */}
                <div className="record-actions" style={{ marginTop: 12, gap: 8 }}>
                  {block.status === "pending_worker" && (
                    <>
                      {showOperatorPicker ? (
                        <PendingApprovalActions
                          sessionBlockId={block.id}
                          sessionId={block.cut_session_id}
                          blockCode={block.block_id}
                          initialOperatorId={block.operator_id ?? null}
                          initialOperatorName={block.operators?.name ?? null}
                          operators={operatorOptions}
                          approveAction={approveBlockWithOperatorAction}
                          approveSkipAction={approveBlockSkipOperatorAction}
                          assignAction={assignOperatorOnlyAction}
                          addOperatorAction={addOperatorAction}
                        />
                      ) : (
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
                            Send to Cutting List →
                          </button>
                        </form>
                      )}
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

                  {/* Waiting to Cut — operator presses Start Cutting when
                   *  they're physically beginning. Cancel reverts to
                   *  pending_worker. */}
                  {block.status === "pending_cut" && (
                    <>
                      <form action={startCuttingAction}>
                        <input type="hidden" name="session_block_id" value={block.id} />
                        <input type="hidden" name="session_id" value={block.cut_session_id} />
                        <button className="primary-button" type="submit">
                          ▶ Start Cutting
                        </button>
                      </form>
                      <form action={undoApproveAction}>
                        <input type="hidden" name="session_block_id" value={block.id} />
                        <input type="hidden" name="session_id" value={block.cut_session_id} />
                        <UndoApproveButton />
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
                    <>
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
                              { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }
                            )}`
                          : ""}
                      </span>
                      {/* Approver attribution — multiple users can sign
                          off (Naresh / Rajesh / Parth / Mafat / dev /
                          owner). Daksh wants the named auditor on the
                          card so accountability is visible at a glance. */}
                      {block.approved_by && profilesMap[block.approved_by] && (
                        <span
                          className="role-pill"
                          style={{
                            fontSize: 11,
                            background: "rgba(34,197,94,0.10)",
                            border: "1px solid rgba(34,197,94,0.35)",
                            color: "#15803d",
                            fontWeight: 600,
                          }}
                          title={
                            block.approved_at
                              ? `Approved on ${new Date(block.approved_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Approved"
                          }
                        >
                          ✓ Approved by{" "}
                          <strong style={{ fontWeight: 700 }}>
                            {profilesMap[block.approved_by]}
                          </strong>
                        </span>
                      )}
                      {eff && (
                        <span
                          title={useActual ? "Real numbers from the completed cut" : "Planner's projection"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 12,
                            fontFamily: "ui-monospace, monospace",
                            padding: "4px 12px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--muted)",
                            flexWrap: "wrap",
                          }}
                        >
                          <span><strong style={{ color: "#15803d" }}>{eff.slabPct}%</strong> slab</span>
                          <span style={{ color: "var(--border)" }}>·</span>
                          <span><strong style={{ color: "#b45309" }}>{eff.restockPct}%</strong> restocked</span>
                          <span style={{ color: "var(--border)" }}>·</span>
                          <span><strong style={{ color: "#b91c1c" }}>{eff.wastePct}%</strong> waste</span>
                          <span style={{ color: "var(--border)" }}>·</span>
                          <span><strong style={{ color: "var(--gold-dark)" }}>{eff.slabPct + eff.restockPct}%</strong> recovered</span>
                          {useActual && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#15803d",
                                background: "rgba(22,101,52,0.12)",
                                padding: "1px 6px",
                                borderRadius: 3,
                                fontFamily: "inherit",
                                marginLeft: 2,
                              }}
                            >
                              ✓ actual
                            </span>
                          )}
                        </span>
                      )}
                    </>
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

        {/* Done tab: search across Earlier + Rejected. Always rendered
            when those sections have content, even if collapsed — clicking
            a result auto-expands the right <details> and scrolls the
            matching card into view with a brief gold ring highlight. */}
        {activeTab === "done" && (earlierRows.length > 0 || rejectedRows.length > 0) && (() => {
          const historyRows: HistoryRow[] = [...earlierRows, ...rejectedRows].map((b) => {
            const realRows = actualSlabRowsByParent.get(b.block_id);
            const slabCount =
              realRows && realRows.length > 0
                ? realRows.length
                : b.cut_session_slabs.length;
            return {
              id: b.id,
              block_id: b.block_id,
              status: b.status === "rejected" ? "rejected" : "done",
              session_code: b.cut_sessions?.session_code ?? null,
              stone: b.layout?.blk?.stone ?? null,
              yard: typeof b.layout?.blk?.yard === "number" ? b.layout.blk.yard : null,
              l: typeof b.layout?.blk?.l === "number" ? b.layout.blk.l : null,
              w: typeof b.layout?.blk?.w === "number" ? b.layout.blk.w : null,
              h: typeof b.layout?.blk?.h === "number" ? b.layout.blk.h : null,
              updated_at: b.updated_at,
              slab_count: slabCount,
            };
          });
          return <CuttingHistorySearchBar rows={historyRows} />;
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
                        // Real cut slabs (planned + manual extras pulled in
                        // from inventory during cutting-done). Same logic
                        // as the active Done Today card so manual adds
                        // surface here too.
                        const realRowsEarlier = actualSlabRowsByParent.get(block.block_id);
                        const slabCount =
                          realRowsEarlier && realRowsEarlier.length > 0
                            ? realRowsEarlier.length
                            : block.cut_session_slabs.length;
                        const plannedIdSetEarlier = new Set(
                          block.cut_session_slabs.map((s) => s.slab_requirement_id),
                        );
                        const manualAddedCountEarlier =
                          realRowsEarlier && realRowsEarlier.length > 0
                            ? realRowsEarlier.filter((s) => !plannedIdSetEarlier.has(s.id)).length
                            : 0;
                        // Same actual-vs-projected logic as the active done list
                        const actualSlabsEarlier = actualSlabsByParent.get(block.block_id);
                        const actualRemaindersEarlier = actualRemaindersByParent.get(block.block_id);
                        const slabsForEffEarlier = (actualSlabsEarlier && actualSlabsEarlier.length > 0)
                          ? actualSlabsEarlier
                          : placed.map((p) => ({ sw: Number(p.sw ?? 0), sh: Number(p.sh ?? 0), sd: Number(p.sd ?? 0) }));
                        const effEarlier = computeActualCutEfficiency(blk, slabsForEffEarlier, actualRemaindersEarlier ?? []);
                        const useActualEarlier = (actualSlabsEarlier?.length ?? 0) > 0 || (actualRemaindersEarlier?.length ?? 0) > 0;
                        return (
                          <div className="plan-card" data-cut-block-id={block.id} key={block.id} style={{ marginBottom: 8 }}>
                            <div className="record-head" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
                                <BlockSelector id={block.id} />
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
                                {block.operators?.name && (
                                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)" }}>
                                    👷 Operator{" "}
                                    <span style={{
                                      color: "#15803d",
                                      fontWeight: 700,
                                      background: "rgba(22,101,52,0.10)",
                                      padding: "1px 7px",
                                      borderRadius: 4,
                                    }}>
                                      {block.operators.name}
                                    </span>
                                  </p>
                                )}
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <span
                                  className="role-pill"
                                  title={
                                    manualAddedCountEarlier > 0
                                      ? `${slabCount - manualAddedCountEarlier} planned + ${manualAddedCountEarlier} added from inventory during cutting`
                                      : undefined
                                  }
                                >
                                  {slabCount} slab{slabCount !== 1 ? "s" : ""}
                                  {manualAddedCountEarlier > 0 && (
                                    <span style={{
                                      marginLeft: 6,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: "#b45309",
                                      background: "rgba(180,83,9,0.14)",
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      letterSpacing: "0.04em",
                                    }}>
                                      +{manualAddedCountEarlier} added
                                    </span>
                                  )}
                                </span>
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
                                {/* Daksh May 2026 — Slab Labels on
                                    Earlier cards too. */}
                                <Link
                                  href={`/cutting/${block.id}/labels`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    textDecoration: "none", fontSize: 12, padding: "4px 12px",
                                    background: "#fffbeb", border: "1px solid #d97706", borderRadius: 6,
                                    color: "#92400e", fontWeight: 600, whiteSpace: "nowrap",
                                  }}
                                  title="Print slab IDs to stencil on the physical slabs"
                                >
                                  🏷 Labels
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
                            {(() => {
                              // Prefer real rows so manual adds surface; fall
                              // back to planner projection if real data is
                              // unavailable.
                              if (realRowsEarlier && realRowsEarlier.length > 0) {
                                return (
                                  <div className="chip-row" style={{ marginTop: 8 }}>
                                    {realRowsEarlier.map((s) => {
                                      const isManual = !plannedIdSetEarlier.has(s.id);
                                      return (
                                        <span
                                          className="plan-chip"
                                          key={s.id}
                                          style={isManual ? {
                                            background: "rgba(120,53,15,0.12)",
                                            border: "1px solid rgba(180,83,9,0.45)",
                                            color: "var(--text)",
                                          } : undefined}
                                          title={isManual ? "Added from inventory during Cutting Done — not in original plan" : undefined}
                                        >
                                          {s.id}
                                          {(s.sw != null || s.sh != null || s.sd != null) && (
                                            <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>
                                              {s.sw ?? "—"}×{s.sh ?? "—"}×{s.sd ?? "—"}″
                                            </span></>
                                          )}
                                          {s.temple ? ` · ${s.temple}` : ""}
                                          {isManual && (
                                            <span style={{
                                              marginLeft: 6,
                                              fontSize: 9,
                                              fontWeight: 700,
                                              letterSpacing: "0.05em",
                                              color: "#b45309",
                                              textTransform: "uppercase",
                                            }}>
                                              + added
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              if (placed.length > 0) {
                                return (
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
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const rems = actualRemaindersByParent.get(block.block_id);
                              if (!rems || rems.length === 0) return null;
                              return (
                                <div style={{ marginTop: 10 }}>
                                  <div style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: "var(--muted)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    marginBottom: 5,
                                  }}>
                                    ♻ Restocked {rems.length} piece{rems.length !== 1 ? "s" : ""}
                                  </div>
                                  <div className="chip-row">
                                    {rems.map(r => {
                                      const stillAvailable = r.status === "available";
                                      return (
                                        <Link
                                          key={r.id}
                                          href={`/blocks/report?block=${encodeURIComponent(r.id)}`}
                                          className="plan-chip"
                                          style={{
                                            textDecoration: "none",
                                            background: stillAvailable ? "rgba(22,101,52,0.12)" : "rgba(255,255,255,0.04)",
                                            border: `1px solid ${stillAvailable ? "rgba(22,101,52,0.35)" : "var(--border)"}`,
                                            color: stillAvailable ? "var(--text)" : "var(--muted)",
                                            fontFamily: "ui-monospace, monospace",
                                          }}
                                          title={`${r.id} · ${r.l}×${r.w}×${r.h} in · ${stillAvailable ? "available" : r.status}`}
                                        >
                                          {r.id}{" · "}
                                          <span>{r.l}×{r.w}×{r.h}″</span>
                                          {" · "}
                                          <span style={{ fontSize: 10, fontWeight: 600, color: stillAvailable ? "#15803d" : "var(--muted)" }}>
                                            {stillAvailable ? "available" : r.status}
                                          </span>
                                        </Link>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="record-actions" style={{ marginTop: 12, gap: 8 }}>
                              <span className="role-pill badge-available" style={{ fontSize: 12 }}>
                                ✓ Done
                                {block.restocked_block_id
                                  ? ` · Restocked ${block.restocked_block_id.split(",").length} piece(s)`
                                  : " · Block discarded"}
                                {block.updated_at
                                  ? ` · ${new Date(block.updated_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}`
                                  : ""}
                              </span>
                              {/* Historical Done-tab card — same approver
                                  pill as the live Done Today card so the
                                  named auditor stays attached to the
                                  record forever. */}
                              {block.approved_by && profilesMap[block.approved_by] && (
                                <span
                                  className="role-pill"
                                  style={{
                                    fontSize: 11,
                                    background: "rgba(34,197,94,0.10)",
                                    border: "1px solid rgba(34,197,94,0.35)",
                                    color: "#15803d",
                                    fontWeight: 600,
                                  }}
                                  title={
                                    block.approved_at
                                      ? `Approved on ${new Date(block.approved_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}`
                                      : "Approved"
                                  }
                                >
                                  ✓ Approved by{" "}
                                  <strong style={{ fontWeight: 700 }}>
                                    {profilesMap[block.approved_by]}
                                  </strong>
                                </span>
                              )}
                              {effEarlier && (
                                <span
                                  title={useActualEarlier ? "Real numbers from the completed cut" : "Planner's projection"}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 10,
                                    fontSize: 12,
                                    fontFamily: "ui-monospace, monospace",
                                    padding: "4px 12px",
                                    background: "var(--bg)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    color: "var(--muted)",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <span><strong style={{ color: "#15803d" }}>{effEarlier.slabPct}%</strong> slab</span>
                                  <span style={{ color: "var(--border)" }}>·</span>
                                  <span><strong style={{ color: "#b45309" }}>{effEarlier.restockPct}%</strong> restocked</span>
                                  <span style={{ color: "var(--border)" }}>·</span>
                                  <span><strong style={{ color: "#b91c1c" }}>{effEarlier.wastePct}%</strong> waste</span>
                                  <span style={{ color: "var(--border)" }}>·</span>
                                  <span><strong style={{ color: "var(--gold-dark)" }}>{effEarlier.slabPct + effEarlier.restockPct}%</strong> recovered</span>
                                  {useActualEarlier && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: "#15803d",
                                        background: "rgba(22,101,52,0.12)",
                                        padding: "1px 6px",
                                        borderRadius: 3,
                                        fontFamily: "inherit",
                                        marginLeft: 2,
                                      }}
                                    >
                                      ✓ actual
                                    </span>
                                  )}
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
                          <div key={block.id} data-cut-block-id={block.id} className="plan-card" style={{ opacity: 0.65, marginBottom: 8 }}>
                            <div className="record-head" style={{ flexWrap: "wrap", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
                                  {block.block_id}
                                </strong>
                                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                                  {block.cut_sessions?.session_code}
                                  {blk ? ` · ${blk.stone} · ${yardLabel(blk.yard)}` : ""}
                                  {block.updated_at ? ` · ${new Date(block.updated_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` : ""}
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
    </SelectionProvider>
  );
}
