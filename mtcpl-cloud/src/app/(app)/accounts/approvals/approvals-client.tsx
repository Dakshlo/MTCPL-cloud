"use client";

/**
 * Bills audit queue — Zoho-style card list.
 *
 * Two sections:
 *   • Awaiting audit — per-row Approve / Edit / Send back.
 *   • Sent back for biller edit — read-only with the note + Edit link.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  Money,
  VendorAvatar,
} from "../_ui/components";

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
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <Section
        title="Awaiting audit"
        emoji="👀"
        emptyMessage="Nothing waiting for audit right now."
        rows={awaiting}
        approveAction={approveAction}
        rejectAction={rejectAction}
        approverActions
      />
      <Section
        title="Sent back for biller edit"
        emoji="↩"
        emptyMessage="No bills currently sitting with billers for edits."
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
  const total = rows.reduce((s, r) => s + r.amountTotal, 0);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
          {emoji} {title}
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>{rows.length}</strong>{" "}
          bill{rows.length === 1 ? "" : "s"}
          {rows.length > 0 && (
            <>
              {" · "}
              <Money value={total} size="small" tone="muted" />
            </>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            padding: "16px 18px",
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 12,
            color: "var(--muted)",
          }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${isRejected ? ACCOUNTS_TOKENS.danger : ACCOUNTS_TOKENS.accent}`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 18px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Vendor + bill identity */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
          <VendorAvatar name={row.vendorName} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <strong style={{ fontSize: 15, color: "var(--text)", letterSpacing: "-0.005em" }}>
                {row.vendorName}
              </strong>
              <code
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  padding: "2px 8px",
                  background: ACCOUNTS_TOKENS.accentLight,
                  color: ACCOUNTS_TOKENS.accent,
                  borderRadius: 4,
                  fontWeight: 700,
                }}
              >
                {row.token}
              </code>
              {row.vendorGstin && (
                <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                  GSTIN {row.vendorGstin}
                </span>
              )}
            </div>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>
              Vendor bill{" "}
              <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{row.vendorBillNo}</code>
              {" · "}
              {new Date(row.billDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              {row.costHead && (
                <>
                  {" · "}
                  <span style={{ color: ACCOUNTS_TOKENS.warning, fontWeight: 600 }}>{row.costHead}</span>
                </>
              )}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              {row.description}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>
              Submitted{" "}
              {row.submittedAt
                ? new Date(row.submittedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
              {row.submittedByName && (
                <>
                  {" "}by{" "}
                  <span style={{ color: ACCOUNTS_TOKENS.accent, fontWeight: 600 }}>{row.submittedByName}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Amount block */}
        <div style={{ textAlign: "right", minWidth: 180 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total
          </div>
          <Money value={row.amountTotal} size="large" tone="accent" />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
            ₹{row.amountSubtotal.toLocaleString("en-IN")} + ₹{gst.toLocaleString("en-IN")} GST ({row.gstPercent}%)
          </div>
          <Link
            href={`/accounts/bills/${row.id}`}
            style={{ ...BUTTON_STYLES.secondary, marginTop: 10, fontSize: 11, padding: "5px 12px" }}
          >
            View detail →
          </Link>
        </div>
      </div>

      {isRejected && row.rejectionNote && (
        <div
          style={{
            margin: "0 18px 16px",
            padding: "10px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: ACCOUNTS_TOKENS.danger,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Auditor note{row.rejectedByName ? ` · from ${row.rejectedByName}` : ""}
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{row.rejectionNote}</p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            margin: "0 18px 16px",
            padding: "10px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.danger,
            fontSize: 12,
          }}
        >
          <strong>Action failed:</strong> {error}
        </div>
      )}

      {/* Action footer */}
      <div
        style={{
          padding: "12px 18px",
          background: ACCOUNTS_TOKENS.surfaceMuted,
          borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {approverActions ? (
          <>
            <button
              type="button"
              onClick={runApprove}
              disabled={pending}
              style={BUTTON_STYLES.primary}
            >
              {pending ? "Approving…" : "✓ Approve"}
            </button>
            <Link href={`/accounts/bills/${row.id}/edit`} style={BUTTON_STYLES.secondary}>
              ✏ Edit
            </Link>
            <button
              type="button"
              onClick={() => setShowReject((v) => !v)}
              disabled={pending}
              style={{
                ...BUTTON_STYLES.danger,
                background: showReject ? ACCOUNTS_TOKENS.dangerLight : "#fff",
              }}
            >
              ↩ Send back for edit
            </button>
          </>
        ) : (
          <Link href={`/accounts/bills/${row.id}/edit`} style={BUTTON_STYLES.secondary}>
            ✏ Open edit form
          </Link>
        )}
      </div>

      {showReject && approverActions && (
        <div
          style={{
            padding: "14px 18px",
            background: "#fff",
            borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Note for the biller (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}

            rows={3}
            style={{
              width: "100%",
              padding: "9px 12px",
              fontSize: 13,
              border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
              borderRadius: 8,
              background: "#fff",
              color: "var(--text)",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={runReject}
              disabled={pending}
              style={{ ...BUTTON_STYLES.primary, background: ACCOUNTS_TOKENS.danger, boxShadow: "0 1px 2px rgba(220,38,38,0.18)" }}
            >
              {pending ? "Sending back…" : "↩ Confirm send back"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReject(false);
                setNote("");
              }}
              disabled={pending}
              style={BUTTON_STYLES.secondary}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
