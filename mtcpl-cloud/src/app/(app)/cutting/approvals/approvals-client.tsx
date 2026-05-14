"use client";

/**
 * Cutting Audit queue — single list, unlock-flag based.
 *
 * Migration 032 retired the second "Sent back for edit" section.
 * Every block in the audit queue sits at status='awaiting_approval'.
 * What changes per-row is `cutterEditUnlocked` — when true, the
 * cutter (team_head submitter) gets an Edit button. When false,
 * only the auditor can edit / approve.
 *
 * Buttons by role × unlock state
 *   Auditor + locked   → [✓ Approve] [✏ Edit] [🔓 Allow cutter to edit]
 *   Auditor + unlocked → [✓ Approve] [✏ Edit] [🔒 Lock cutter edit]
 *                        + small "🔓 Cutter can edit · note" indicator
 *   Cutter + locked    → read-only ("Waiting for auditor review")
 *   Cutter + unlocked  → [✏ Edit submission] · "Auditor unlocked editing"
 *                        + sent-back-note prominently
 *
 * Edit doesn't open a modal — it navigates to /cutting/[id]?edit=approval
 * which renders the pre-filled FinishBlockForm.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ApprovalRow = {
  id: string;
  blockId: string;
  sessionCode: string | null;
  stone: string | null;
  yard: number | null;
  cutterEditUnlocked: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  operatorName: string | null;
  unlockAt: string | null;
  unlockByName: string | null;
  unlockNote: string | null;
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
  rows,
  approveAction,
  unlockAction,
  lockAction,
}: {
  canApprove: boolean;
  rows: ApprovalRow[];
  approveAction: (formData: FormData) => Promise<ServerResult>;
  unlockAction: (formData: FormData) => Promise<ServerResult>;
  lockAction: (formData: FormData) => Promise<ServerResult>;
}) {
  return (
    <div style={{ marginTop: 18 }}>
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
          👀 Awaiting audit
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} block{rows.length === 1 ? "" : "s"}
        </span>
        {rows.some((r) => r.cutterEditUnlocked) && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            ·{" "}
            <span style={{ color: "#15803d", fontWeight: 600 }}>
              {rows.filter((r) => r.cutterEditUnlocked).length} unlocked
            </span>
            {" "}for cutter edit
          </span>
        )}
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
          {canApprove
            ? "Nothing waiting for audit right now."
            : "You don't have any Cutting Done submissions waiting for audit."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <ApprovalCard
              key={row.id}
              row={row}
              canApprove={canApprove}
              approveAction={approveAction}
              unlockAction={unlockAction}
              lockAction={lockAction}
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
  unlockAction,
  lockAction,
}: {
  row: ApprovalRow;
  canApprove: boolean;
  approveAction: (formData: FormData) => Promise<ServerResult>;
  unlockAction: (formData: FormData) => Promise<ServerResult>;
  lockAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockNote, setUnlockNote] = useState("");

  const summary = row.payloadSummary;
  const unlocked = row.cutterEditUnlocked;

  // Cutters edit only when unlocked. Approvers edit any time.
  const cutterCanEdit = !canApprove && unlocked && row.isOwnSubmission;

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

  function runUnlock() {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("session_block_id", row.id);
      fd.set("note", unlockNote.trim());
      const result = await unlockAction(fd);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setShowUnlock(false);
      setUnlockNote("");
      router.refresh();
    });
  }

  function runLock() {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("session_block_id", row.id);
      const result = await lockAction(fd);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="plan-card"
      style={
        unlocked
          ? { borderLeft: "5px solid #16a34a", background: "rgba(34, 197, 94, 0.05)" }
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
                {" "}by{" "}
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
          <span
            className="role-pill"
            style={{
              background: "var(--gold)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            👀 Awaiting audit
          </span>
          {unlocked && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(34, 197, 94, 0.14)",
                color: "#15803d",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
              title={
                row.unlockNote
                  ? `Cutter can edit · note: ${row.unlockNote}`
                  : "Cutter can edit this block"
              }
            >
              🔓 Cutter unlocked
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

      {/* Sent-back / unlock note — prominently shown when present and
          the block is currently unlocked. Auditor sees this for context;
          cutter sees this as the "what to fix" reminder. */}
      {unlocked && row.unlockNote && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "rgba(34, 197, 94, 0.10)",
            border: "1px solid rgba(22, 163, 74, 0.35)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#15803d",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            🔓 Auditor note · cutter can edit
            {row.unlockByName ? ` · from ${row.unlockByName}` : ""}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            {row.unlockNote}
          </p>
        </div>
      )}

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

      <div
        className="record-actions"
        style={{ marginTop: 12, gap: 8, display: "flex", flexWrap: "wrap" }}
      >
        {/* Auditor — full action set */}
        {canApprove && (
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
            {unlocked ? (
              <button
                type="button"
                onClick={runLock}
                disabled={pending}
                style={{
                  fontSize: 13,
                  padding: "8px 16px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "#b45309",
                  fontWeight: 600,
                  cursor: pending ? "wait" : "pointer",
                }}
                title="Revoke cutter's edit permission. Cutter goes back to read-only."
              >
                🔒 Lock cutter edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowUnlock((v) => !v)}
                disabled={pending}
                style={{
                  fontSize: 13,
                  padding: "8px 16px",
                  background: showUnlock ? "rgba(22, 163, 74, 0.14)" : "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "#15803d",
                  fontWeight: 600,
                  cursor: pending ? "wait" : "pointer",
                }}
                title="Allow the cutter to edit this block. Status stays awaiting_approval."
              >
                🔓 Allow cutter to edit
              </button>
            )}
          </>
        )}

        {/* Cutter — view-only or edit (when unlocked) */}
        {cutterCanEdit && (
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
        {!canApprove && !cutterCanEdit && row.isOwnSubmission && (
          <span
            className="muted"
            style={{
              fontSize: 12,
              padding: "6px 12px",
              border: "1px dashed var(--border)",
              borderRadius: 6,
            }}
          >
            Waiting for auditor review. You'll get an Edit button if
            they unlock the row for you.
          </span>
        )}
      </div>

      {showUnlock && canApprove && !unlocked && (
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
            value={unlockNote}
            onChange={(e) => setUnlockNote(e.target.value)}
            placeholder="e.g. 'Check slab MH-0018-2 — looks like it wasn't cut. Fix and resubmit.'"
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
              onClick={runUnlock}
              disabled={pending}
              className="primary-button"
              style={{ fontSize: 13, background: "#16a34a" }}
            >
              {pending ? "Unlocking…" : "🔓 Allow cutter to edit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUnlock(false);
                setUnlockNote("");
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
