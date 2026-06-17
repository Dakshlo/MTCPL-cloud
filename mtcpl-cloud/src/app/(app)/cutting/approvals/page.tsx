// Cut-approval review queue (migration 027 + 032 refactor).
//
// ONE section now: every awaiting_approval block. Migration 032
// retired the "Sent back for edit" section — sending back to the
// cutter now flips a `cutter_edit_unlocked` flag instead of changing
// status, so all blocks stay in the same audit queue while edit
// permission shuttles between auditor and cutter.
//
// Audience-aware filtering:
//   • Approver (developer / owner / can_approve_cuts team_head) →
//     sees every block. Can Approve, Edit, or Allow / Lock cutter edit.
//   • Cutter (team_head submitter, cutting_operator) → sees their own
//     submissions only. Read-only by default; gets an Edit button if
//     the auditor has unlocked the row.

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canApproveCuts } from "@/lib/cutting-permissions";
import { computeActualCutEfficiency } from "@/lib/cut-efficiency";
import { ApprovalsClient, type ApprovalRow } from "./approvals-client";
import {
  approveCutAction,
  lockCutterEditAction,
  requestCutterEditAction,
} from "../actions";

type PendingPayload = {
  cut_slab_ids?: string[];
  not_cut_slab_ids?: string[];
  extra_slab_ids?: string[];
  transferred_slab_ids?: string[];
  remainders?: Array<{ id?: string; l?: number; w?: number; h?: number }>;
  stock_location?: string | null;
  restock?: boolean;
};

export default async function CuttingApprovalsPage() {
  // Approval audience: dev + owner (always), team_head + carving_head +
  // crosscheck (gated by can_approve_cuts flag — see canApproveCuts
  // below), and cutting_operator (read-only resubmit path).
  //
  // Before: only ["developer","owner","team_head","cutting_operator"]
  // was listed → Parth (carving_head) + Mafat (crosscheck) clicked the
  // top-bar Cutting Audit link and got bounced to their default route
  // (ready-size for the carving head) by requireAuth's role guard. The
  // can_approve_cuts flag was already wired in canApproveCuts(), but
  // requireAuth's role allow-list never let those roles reach the page.
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "team_head",
    "senior_incharge",
    "carving_head",
    "crosscheck",
    "cutting_operator",
  ]);
  const canApprove = canApproveCuts(profile);
  // Shift-handoff (mirrors editPendingApprovalAction's authorisation):
  // a team_head / senior_incharge / cutting_operator may edit an
  // UNLOCKED block even if they didn't personally submit it. Without
  // this, the approvals list hid every block this team_head hadn't
  // submitted himself, so after the auditor pressed "Allow cutter to
  // edit" no "Edit submission" button ever appeared for him.
  const canEditUnlockedAsCutter =
    profile.role === "team_head" ||
    profile.role === "senior_incharge" ||
    profile.role === "cutting_operator";
  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // Pull every block currently waiting for audit. Includes any legacy
  // awaiting_cutter_edit rows that migration 032 should have flipped
  // back to awaiting_approval, just in case the migration didn't run.
  const { data: rowsRaw, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, cut_session_id, layout, pending_approval_payload, cutter_edit_unlocked, submitted_for_approval_at, submitted_for_approval_by, sent_back_at, sent_back_by, sent_back_note, approval_edited_at, approval_edited_by, operator_id, precut_count, operators(id, name), cut_sessions(session_code, kerf_mm, planned_by)",
    )
    .in("status", ["awaiting_approval", "awaiting_cutter_edit"])
    .order("submitted_for_approval_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  type DbRow = {
    id: string;
    status: string;
    block_id: string;
    cut_session_id: string;
    layout: {
      blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
    } | null;
    pending_approval_payload: PendingPayload | null;
    cutter_edit_unlocked: boolean | null;
    submitted_for_approval_at: string | null;
    submitted_for_approval_by: string | null;
    sent_back_at: string | null;
    sent_back_by: string | null;
    sent_back_note: string | null;
    approval_edited_at: string | null;
    approval_edited_by: string | null;
    operator_id: string | null;
    precut_count: number | null;
    operators: { id: string; name: string } | null;
    cut_sessions: { session_code: string; kerf_mm: number; planned_by: string | null } | null;
  };

  const dbRows = (rowsRaw ?? []) as unknown as DbRow[];

  const visible = canApprove
    ? dbRows
    : dbRows.filter(
        (r) =>
          r.submitted_for_approval_by === profile.id ||
          // Shift-handoff: surface blocks the auditor has unlocked for
          // cutter editing to any cutter-role user, not only the
          // original submitter — matches what the edit action allows.
          (canEditUnlockedAsCutter &&
            (r.cutter_edit_unlocked === true ||
              r.status === "awaiting_cutter_edit")),
      );

  // Projected-recovery data for the audit cards: fetch the dims of every
  // cut + extra slab in the visible submissions so each card can show the
  // same green / yellow / red efficiency bar BEFORE approval.
  const slabIdSet = new Set<string>();
  for (const r of visible) {
    const p = r.pending_approval_payload;
    for (const id of p?.cut_slab_ids ?? []) slabIdSet.add(id);
    for (const id of p?.extra_slab_ids ?? []) slabIdSet.add(id);
  }
  const slabDims = new Map<string, { sw: number; sh: number; sd: number }>();
  const allSlabIds = [...slabIdSet];
  for (let i = 0; i < allSlabIds.length; i += 1000) {
    const chunk = allSlabIds.slice(i, i + 1000);
    if (chunk.length === 0) break;
    const { data: dimRows } = await supabase
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", chunk);
    for (const s of (dimRows ?? []) as Array<{ id: string; length_ft: number; width_ft: number; thickness_ft: number }>) {
      slabDims.set(s.id, { sw: Number(s.length_ft), sh: Number(s.width_ft), sd: Number(s.thickness_ft) });
    }
  }

  const rows: ApprovalRow[] = visible.map((r) => {
    const payload = r.pending_approval_payload ?? null;
    // Projected recovery from the submitted payload (becomes actual on approval).
    const blk = r.layout?.blk ?? null;
    const slabsForEff = [
      ...(payload?.cut_slab_ids ?? []),
      ...(payload?.extra_slab_ids ?? []),
    ].map((id) => slabDims.get(id)).filter(Boolean) as Array<{ sw: number; sh: number; sd: number }>;
    const remsForEff = (payload?.remainders ?? [])
      .map((rm) => ({ l: Number(rm.l ?? 0), w: Number(rm.w ?? 0), h: Number(rm.h ?? 0) }))
      .filter((rm) => rm.l > 0 && rm.w > 0 && rm.h > 0);
    const eff = blk
      ? computeActualCutEfficiency({ l: blk.l, w: blk.w, h: blk.h }, slabsForEff, remsForEff)
      : null;
    // Migration 032: legacy awaiting_cutter_edit rows are treated as
    // awaiting_approval + unlocked. The DB migration should have
    // normalised these but we mirror it here defensively.
    const unlocked = r.status === "awaiting_cutter_edit" || r.cutter_edit_unlocked === true;
    return {
      id: r.id,
      blockId: r.block_id,
      sessionCode: r.cut_sessions?.session_code ?? null,
      stone: r.layout?.blk?.stone ?? null,
      yard: r.layout?.blk?.yard ?? null,
      precutCount: Number(r.precut_count) || 0,
      cutterEditUnlocked: unlocked,
      submittedAt: r.submitted_for_approval_at,
      submittedByName: r.submitted_for_approval_by
        ? profilesMap[r.submitted_for_approval_by] ?? "Unknown"
        : null,
      operatorName: r.operators?.name ?? null,
      unlockAt: r.sent_back_at,
      unlockByName: r.sent_back_by
        ? profilesMap[r.sent_back_by] ?? "Unknown"
        : null,
      unlockNote: r.sent_back_note,
      editedAt: r.approval_edited_at,
      editedByName: r.approval_edited_by
        ? profilesMap[r.approval_edited_by] ?? "Unknown"
        : null,
      payloadSummary: payload
        ? {
            cutCount: payload.cut_slab_ids?.length ?? 0,
            notCutCount: payload.not_cut_slab_ids?.length ?? 0,
            extraCount: payload.extra_slab_ids?.length ?? 0,
            transferCount: payload.transferred_slab_ids?.length ?? 0,
            remainderCount: payload.remainders?.length ?? 0,
            stockLocation: payload.stock_location ?? null,
            restock: payload.restock ?? false,
          }
        : null,
      isOwnSubmission: r.submitted_for_approval_by === profile.id,
      recovery: eff
        ? { slabPct: eff.slabPct, restockPct: eff.restockPct, wastePct: eff.wastePct }
        : null,
    };
  });

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Cutting Audit</h1>
          <p className="muted">
            {canApprove
              ? "Audit every Cutting Done submission before it commits. Approve as-is, edit in place, or allow the cutter to fix it."
              : "Your Cutting Done submissions awaiting audit. View any time; edit when the auditor unlocks the row for you."}
          </p>
        </div>
        <Link
          href="/cutting"
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "6px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          ← Cutting
        </Link>
      </div>

      <ApprovalsClient
        canApprove={canApprove}
        canEditUnlockedAsCutter={canEditUnlockedAsCutter}
        rows={rows}
        approveAction={approveCutAction}
        unlockAction={requestCutterEditAction}
        lockAction={lockCutterEditAction}
      />
    </section>
  );
}
