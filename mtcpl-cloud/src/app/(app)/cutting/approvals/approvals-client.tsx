"use client";

/**
 * Approvals queue — list view + per-row controls.
 *
 * Sections
 *   A. Awaiting approval — cutter has submitted, approver hasn't acted.
 *   B. Sent back for edit — approver asked the cutter to fix.
 *
 * Buttons by role × status
 *   awaiting_approval + approver  → [✓ Approve] [✏ Edit] [↩ Send back]
 *   awaiting_approval + cutter    → read-only ("Waiting for review")
 *   awaiting_cutter_edit + approver → [✏ Edit] [✓ Approve as-is]
 *   awaiting_cutter_edit + cutter (own) → [✏ Edit] (with note shown)
 *   anything else / not-own → read-only
 *
 * Edit doesn't open a modal — it navigates to the existing
 * /cutting/[id] detail page, which re-uses the same 3D preview +
 * FinishBlockForm with `initialPayload` pre-filled. Keeping a single
 * canonical surface for the cutter form avoids drift between two
 * UI copies.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ApprovalRow = {
  id: string;
  status: "awaiting_approval" | "awaiting_cutter_edit";
  blockId: string;
  sessionCode: string | null;
  stone: string | null;
  yard: number | null;
  submittedAt: string | null;
  submittedByName: string | null;
  operatorName: string | null;
  sentBackAt: string | null;
  sentBackByName: string | null;
  sentBackNote: string | null;
  editedAt: string | null;
  editedByName: string | null;
  payloadSummary: {
    cutCount: number;
    notCutCount: number;
    extraCount: number;
    transferCount: number;
    remainderCount: number;
    stockLocation: string | null;
    restock: boolean;
  } | null;
  isOwnSubmission: boolean;
};

type ServerResult = { ok: true } | { ok: false; error: string };

export function ApprovalsClient({
  canApprove,
  awaitingApproval,
  awaitingCutterEdit,
  approveAction,
  sendBackAction,
}: {
  canApprove: boolean;
  awaitingApproval: ApprovalRow[];
  awaitingCutterEdit: ApprovalRow[];
  approveAction: (formData: FormData) => Promise<ServerResult>;
  sendBackAction: (formData: FormData) => Promise<ServerResult>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 18 }}>
      <Section
        title="Awaiting approval"
        emoji="👀"
        emptyMessage={
          canApprove
            ? "Nothing waiting for approval right now."
            : "You don't have any submissions waiting for approval."
        }
        rows={awaitingApproval}
        canApprove={canApprove}
        approveAction={approveAction}
        sendBackAction={sendBackAction}
      />
      <Section
        title="Sent back for edit"
        emoji="↩"
        emptyMessage={
          canApprove
            ? "Nothing currently sitting with cutters for edits."
            : "Nothing was sent back to you. You'll see it here when an approver asks for changes."
        }
        rows={awaitingCutterEdit}
        canApprove={canApprove}
        approveAction={approveAction}
        sendBackAction={sendBackAction}
      />
    </div>
  );
}

function Section({
  title,
  emoji,
  emptyMessage,
  rows,
  canApprove,
  approveAction,
  sendBackAction,
}: {
  title: string;
  emoji: string;
  emptyMessage: string;
  rows: ApprovalRow[];
  canApprove: boolean;
  approveAction: (formData: FormData) => Promise<ServerResult>;
  sendBackAction: (formData: FormData) => Promise<ServerResult>;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 10,
          paddingBottom: 6,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
          {emoji} {title}
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} block{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          className="muted"
          style={{
            fontSize: 12,
            padding: "10px 14px",
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 6,
          }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <ApprovalCard
              key={row.id}
              row={row}
              canApprove={canApprove}
              approveAction={approveAction}
              sendBackAction={sendBackAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  row,
  canApprove,
  approveAction,
  sendBackAction,
}: {
  row: ApprovalRow;
  canApprove: boolean;
  approveAction: (formData: FormData) => Promise<ServerResult>;
  sendBackAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [sendBackNote, setSendBackNote] = useState("");

  const summary = row.payloadSummary;
  const isAwaitingApproval = row.status === "awaiting_approval";
  const isCutterEdit = row.status === "awaiting_cutter_edit";

  const canCutterEditThisRow = isCutterEdit && (canApprove || row.isOwnSubmission);

  function runApprove() {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("session_block_id", row.id);
      const result = await approveAction(fd);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function runSendBack() {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("session_block_id", row.id);
      fd.set("note", sendBackNote.trim());
      const result = await sendBackAction(fd);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setShowSendBack(false);
      setSendBackNote("");
      router.refresh();
    });
  }

  return (
    <div
      className="plan-card"
      style={
        isCutterEdit
          ? { borderLeft: "5px solid #b45309", background: "rgba(180,83,9,0.05)" }
          : { borderLeft: "5px solid var(--gold-dark)" }
      }
    >
      <div className="record-head" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
            {row.blockId}
          </strong>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            {row.sessionCode ?? "—"}
            {row.stone ? ` · ${row.stone}` : ""}
            {typeof row.yard === "number" ? ` · Yard ${row.yard}` : ""}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
            Submitted{" "}
            {row.submittedAt
              ? new Date(row.submittedAt).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
            {row.submittedByName && (
              <>
                {" "}
                by{" "}
                <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                  {row.submittedByName}
                </span>
              </>
            )}
            {row.operatorName && (
              <>
                {" · "}
                👷{" "}
                <span style={{ color: "#15803d", fontWeight: 600 }}>
                  {row.operatorName}
                </span>
              </>
            )}
          </p>
          {row.editedAt && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
              Last edited{" "}
              {new Date(row.editedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {row.editedByName ? ` by ${row.editedByName}` : ""}
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {isAwaitingApproval ? (
            <span
              className="role-pill"
              style={{
                background: "var(--gold)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              👀 Awaiting approval
            </span>
          ) : (
            <span
              className="role-pill"
              style={{
                background: "#b45309",
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              ↩ Sent back for edit
            </span>
          )}
          <Link
            href={`/cutting/${row.id}`}
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

      {/* Payload summary chips */}
      {summary && (
        <div
          className="chip-row"
          style={{
            marginTop: 10,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <SummaryChip label="cut" count={summary.cutCount} color="#15803d" />
          {summary.notCutCount > 0 && (
            <SummaryChip label="not cut" count={summary.notCutCount} color="#b91c1c" />
          )}
          {summary.extraCount > 0 && (
            <SummaryChip label="from inventory" count={summary.extraCount} color="#b45309" />
          )}
          {summary.transferCount > 0 && (
            <SummaryChip
              label="transferred"
              count={summary.transferCount}
              color="#7c3aed"
            />
          )}
          {summary.remainderCount > 0 && (
            <SummaryChip
              label="remainder pcs"
              count={summary.remainderCount}
              color="#0f766e"
            />
          )}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            📍{" "}
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {summary.stockLocation ?? "—"}
            </span>
          </span>
          {summary.restock && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#0f766e",
                background: "rgba(15,118,110,0.12)",
                padding: "2px 8px",
                borderRadius: 4,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              ♻ Restock
            </span>
          )}
        </div>
      )}

      {/* Sent-back note prominently displayed when present */}
      {isCutterEdit && row.sentBackNote && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "rgba(180,83,9,0.10)",
            border: "1px solid rgba(180,83,9,0.35)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#b45309",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            ↩ Approver note
            {row.sentBackByName ? ` · from ${row.sentBackByName}` : ""}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            {row.sentBackNote}
          </p>
        </div>
      )}

      {/* Action error banner */}
      {actionError && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1.5px solid #dc2626",
            borderRadius: 6,
            color: "#7f1d1d",
            fontSize: 12,
          }}
        >
          <strong>Action failed:</strong> {actionError}
        </div>
      )}

      {/* Per-row buttons */}
      <div
        className="record-actions"
        style={{ marginTop: 12, gap: 8, display: "flex", flexWrap: "wrap" }}
      >
        {/* Approver actions on awaiting_approval */}
        {canApprove && isAwaitingApproval && (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={runApprove}
              disabled={pending}
              style={{ fontSize: 13 }}
            >
              {pending ? "Approving…" : "✓ Approve"}
            </button>
            <Link
              href={`/cutting/${row.id}?edit=approval`}
              style={{
                textDecoration: "none",
                fontSize: 13,
                padding: "8px 16px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              ✏ Edit
            </Link>
            <button
              type="button"
              onClick={() => setShowSendBack((v) => !v)}
              disabled={pending}
              style={{
                fontSize: 13,
                padding: "8px 16px",
                background: showSendBack ? "rgba(180,83,9,0.18)" : "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "#b45309",
                fontWeight: 600,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              ↩ Send back for edit
            </button>
          </>
        )}

        {/* Approver actions on awaiting_cutter_edit */}
        {canApprove && isCutterEdit && (
          <>
            <Link
              href={`/cutting/${row.id}?edit=approval`}
              style={{
                textDecoration: "none",
                fontSize: 13,
                padding: "8px 16px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              ✏ Edit
            </Link>
            <button
              type="button"
              className="primary-button"
              onClick={runApprove}
              disabled={pending}
              style={{ fontSize: 13 }}
              title="Approve as-is (skip cutter edit)"
            >
              {pending ? "Approving…" : "✓ Approve as-is"}
            </button>
          </>
        )}

        {/* Cutter editing their own block that was sent back */}
        {!canApprove && canCutterEditThisRow && (
          <Link
            href={`/cutting/${row.id}?edit=approval`}
            className="primary-button"
            style={{
              textDecoration: "none",
              fontSize: 13,
              padding: "8px 16px",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            ✏ Edit submission
          </Link>
        )}

        {/* Cutter on their own block in awaiting_approval — read-only */}
        {!canApprove && isAwaitingApproval && row.isOwnSubmission && (
          <span
            className="muted"
            style={{
              fontSize: 12,
              padding: "6px 12px",
              border: "1px dashed var(--border)",
              borderRadius: 6,
            }}
          >
            Waiting for approver review. You'll get a button to edit if they
            send it back.
          </span>
        )}
      </div>

      {/* Send-back dialog (inline) */}
      {showSendBack && canApprove && isAwaitingApproval && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Note for the cutter (optional)
          </label>
          <textarea
            value={sendBackNote}
            onChange={(e) => setSendBackNote(e.target.value)}
            placeholder="e.g. Check slab MH-0018-2 — looks like it wasn't actually cut. Also re-confirm the transfer from Block 12."
            rows={3}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "8px 10px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--surface)",
              color: "var(--text)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={runSendBack}
              disabled={pending}
              className="primary-button"
              style={{ fontSize: 13, background: "#b45309" }}
            >
              {pending ? "Sending back…" : "↩ Confirm send back"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSendBack(false);
                setSendBackNote("");
              }}
              disabled={pending}
              style={{
                fontSize: 13,
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--muted)",
                fontWeight: 500,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        padding: "3px 9px",
        background: `${color}1F`,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        color: "var(--text)",
        fontWeight: 600,
      }}
    >
      <strong style={{ color, fontFamily: "ui-monospace, monospace" }}>
        {count}
      </strong>
      <span style={{ color: "var(--muted)", fontWeight: 500 }}>{label}</span>
    </span>
  );
}
