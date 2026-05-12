// Cut-approval review queue (migration 027).
//
// Lists every cut_session_block with status awaiting_approval or
// awaiting_cutter_edit — the supervisor's queue between Cutting Done
// and Done Today. Approvers (developer / owner / team_head with
// can_approve_cuts=TRUE) see every block and can act on it; cutters
// see ONLY their own (read-only while awaiting_approval, editable
// once sent back to them).
//
// The list is intentionally simple — block id, session code, cutter
// name, submitted-at, payload summary, plus the per-row actions.
// Deep review (3D preview, full slab chips) happens on the existing
// /cutting/[id] detail page which now also renders the approval
// surface based on block.status.

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canApproveCuts } from "@/lib/cutting-permissions";
import { ApprovalsClient, type ApprovalRow } from "./approvals-client";
import {
  approveCutAction,
  requestCutterEditAction,
} from "../actions";

type PendingPayload = {
  cut_slab_ids?: string[];
  not_cut_slab_ids?: string[];
  extra_slab_ids?: string[];
  transferred_slab_ids?: string[];
  remainders?: Array<{ id: string }>;
  stock_location?: string | null;
  restock?: boolean;
};

export default async function CuttingApprovalsPage() {
  // Approvers + cutting operators both reach this page. The query
  // below filters cutters down to their own submissions; approvers
  // see everyone's.
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "team_head",
    "cutting_operator",
  ]);
  const canApprove = canApproveCuts(profile);
  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // Pull both awaiting buckets in one query. Cutters get filtered
  // down to their own submissions client-side (we already have the
  // submitter id on each row — keeps the SQL simple).
  const { data: rowsRaw, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, cut_session_id, layout, pending_approval_payload, submitted_for_approval_at, submitted_for_approval_by, sent_back_at, sent_back_by, sent_back_note, approval_edited_at, approval_edited_by, operator_id, operators(id, name), cut_sessions(session_code, kerf_mm, planned_by)",
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
    submitted_for_approval_at: string | null;
    submitted_for_approval_by: string | null;
    sent_back_at: string | null;
    sent_back_by: string | null;
    sent_back_note: string | null;
    approval_edited_at: string | null;
    approval_edited_by: string | null;
    operator_id: string | null;
    operators: { id: string; name: string } | null;
    cut_sessions: { session_code: string; kerf_mm: number; planned_by: string | null } | null;
  };

  const dbRows = (rowsRaw ?? []) as unknown as DbRow[];

  // Cutter filter — only see your own. Approver path keeps everything.
  const visible = canApprove
    ? dbRows
    : dbRows.filter((r) => r.submitted_for_approval_by === profile.id);

  const rows: ApprovalRow[] = visible.map((r) => {
    const payload = r.pending_approval_payload ?? null;
    return {
      id: r.id,
      status: r.status as "awaiting_approval" | "awaiting_cutter_edit",
      blockId: r.block_id,
      sessionCode: r.cut_sessions?.session_code ?? null,
      stone: r.layout?.blk?.stone ?? null,
      yard: r.layout?.blk?.yard ?? null,
      submittedAt: r.submitted_for_approval_at,
      submittedByName: r.submitted_for_approval_by
        ? profilesMap[r.submitted_for_approval_by] ?? "Unknown"
        : null,
      operatorName: r.operators?.name ?? null,
      sentBackAt: r.sent_back_at,
      sentBackByName: r.sent_back_by
        ? profilesMap[r.sent_back_by] ?? "Unknown"
        : null,
      sentBackNote: r.sent_back_note,
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
    };
  });

  const awaitingApproval = rows.filter((r) => r.status === "awaiting_approval");
  const awaitingCutterEdit = rows.filter((r) => r.status === "awaiting_cutter_edit");

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Cutting Audit</h1>
          <p className="muted">
            {canApprove
              ? "Audit every Cutting Done submission before it commits. Approve as-is, edit in place, or send back to the cutter with a note."
              : "Your Cutting Done submissions awaiting audit. You can edit only after the auditor sends a block back to you."}
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
        awaitingApproval={awaitingApproval}
        awaitingCutterEdit={awaitingCutterEdit}
        approveAction={approveCutAction}
        sendBackAction={requestCutterEditAction}
      />
    </section>
  );
}
