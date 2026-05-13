"use client";

/**
 * Bills audit queue — list view + per-row controls.
 * Mirrors /cutting/approvals/approvals-client.tsx one-for-one.
 *
 * Sections
 *   A. Awaiting approval — biller has submitted, approver hasn't acted.
 *   B. Rejected (awaiting biller edit) — read-only summary with the note.
 *
 * Approver buttons (awaiting_approval):
 *   - ✓ Approve         → approveBillAction
 *   - ✏ Edit            → /accounts/bills/[id]/edit
 *   - ↩ Send back       → inline note textarea → rejectBillAction
 *
 * For rejected rows, no inline actions; the biller (or approver) edits
 * via the dedicated /accounts/bills/[id]/edit route which is linked
 * from each card.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ApprovalBillRow = {
  id: string;
  token: string;
  vendorName: string;
  vendorGstin: string | null;
  vendorBillNo: string;
  billDate: string;
  description: string;
  costHead: string | null;
  amountSubtotal: number;
  gstPercent: number;
  amountTotal: number;
  status: "pending_approval" | "rejected";
  rejectionNote: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
};

type ServerResult = { ok: true } | { ok: false; error: string };

export function ApprovalsClient({
  awaiting,
  rejected,
  approveAction,
  rejectAction,
}: {
  awaiting: ApprovalBillRow[];
  rejected: ApprovalBillRow[];
  approveAction: (formData: FormData) => Promise<ServerResult>;
  rejectAction: (formData: FormData) => Promise<ServerResult>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 18 }}>
      <Section
        title="Awaiting approval"
        emoji="👀"
        emptyMessage="Nothing waiting for approval right now."
        rows={awaiting}
        approveAction={approveAction}
        rejectAction={rejectAction}
        approverActions
      />
      <Section
        title="Rejected (waiting for biller edit)"
        emoji="↩"
        emptyMessage="No rejected bills currently. They'll show up here when an audit fails."
        rows={rejected}
        approveAction={approveAction}
        rejectAction={rejectAction}
        approverActions={false}
      />
    </div>
  );
}

function Section({
  title,
  emoji,
  emptyMessage,
  rows,
  approveAction,
  rejectAction,
  approverActions,
}: {
  title: string;
  emoji: string;
  emptyMessage: string;
  rows: ApprovalBillRow[];
  approveAction: (formData: FormData) => Promise<ServerResult>;
  rejectAction: (formData: FormData) => Promise<ServerResult>;
  approverActions: boolean;
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
          {rows.length} bill{rows.length === 1 ? "" : "s"}
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
            <BillAuditCard
              key={row.id}
              row={row}
              approveAction={approveAction}
              rejectAction={rejectAction}
              approverActions={approverActions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BillAuditCard({
  row,
  approveAction,
  rejectAction,
  approverActions,
}: {
  row: ApprovalBillRow;
  approveAction: (formData: FormData) => Promise<ServerResult>;
  rejectAction: (formData: FormData) => Promise<ServerResult>;
  approverActions: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");

  const isRejected = row.status === "rejected";

  function runApprove() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", row.id);
      const r = await approveAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function runReject() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", row.id);
      fd.set("note", note.trim());
      const r = await rejectAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setShowReject(false);
      setNote("");
      router.refresh();
    });
  }

  const gst = row.amountTotal - row.amountSubtotal;

  return (
    <div
      className="plan-card"
      style={
        isRejected
          ? { borderLeft: "5px solid #b45309", background: "rgba(180,83,9,0.05)" }
          : { borderLeft: "5px solid var(--gold-dark)" }
      }
    >
      <div className="record-head" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 700 }}>
              {row.token}
            </code>
            <strong style={{ fontSize: 14 }}>{row.vendorName}</strong>
            {row.vendorGstin && (
              <span className="muted" style={{ fontSize: 11 }}>
                GSTIN {row.vendorGstin}
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Vendor bill no <strong style={{ color: "var(--text)" }}>{row.vendorBillNo}</strong>
            {" · "}
            {new Date(row.billDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {row.costHead && (
              <>
                {" · "}
                <span style={{ color: "#b45309", fontWeight: 600 }}>{row.costHead}</span>
              </>
            )}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.4 }}>{row.description}</p>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
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
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ fontFamily: "ui-monospace, monospace", textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>
              Total
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold-dark)" }}>
              ₹{row.amountTotal.toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
              ₹{row.amountSubtotal.toLocaleString("en-IN")} + ₹{gst.toLocaleString("en-IN")} GST ({row.gstPercent}%)
            </div>
          </div>
          <Link
            href={`/accounts/bills/${row.id}`}
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

      {isRejected && row.rejectionNote && (
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
            Approver note
            {row.rejectedByName ? ` · from ${row.rejectedByName}` : ""}
          </div>
          <p style={{ margin: 0, fontSize: 13 }}>{row.rejectionNote}</p>
        </div>
      )}

      {error && (
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
          <strong>Action failed:</strong> {error}
        </div>
      )}

      {approverActions && (
        <div
          className="record-actions"
          style={{ marginTop: 12, gap: 8, display: "flex", flexWrap: "wrap" }}
        >
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
            href={`/accounts/bills/${row.id}/edit`}
            style={{
              textDecoration: "none",
              fontSize: 13,
              padding: "8px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            ✏ Edit
          </Link>
          <button
            type="button"
            onClick={() => setShowReject((v) => !v)}
            disabled={pending}
            style={{
              fontSize: 13,
              padding: "8px 16px",
              background: showReject ? "rgba(180,83,9,0.18)" : "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "#b45309",
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
            }}
          >
            ↩ Send back for edit
          </button>
        </div>
      )}

      {!approverActions && (
        <div className="record-actions" style={{ marginTop: 12, gap: 8 }}>
          <Link
            href={`/accounts/bills/${row.id}/edit`}
            style={{
              textDecoration: "none",
              fontSize: 13,
              padding: "8px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            ✏ Open edit form
          </Link>
        </div>
      )}

      {showReject && approverActions && (
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
            Note for the biller (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Check the amount — total seems off. Re-confirm GST%."
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
              onClick={runReject}
              disabled={pending}
              className="primary-button"
              style={{ fontSize: 13, background: "#b45309" }}
            >
              {pending ? "Sending back…" : "↩ Confirm reject"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReject(false);
                setNote("");
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
