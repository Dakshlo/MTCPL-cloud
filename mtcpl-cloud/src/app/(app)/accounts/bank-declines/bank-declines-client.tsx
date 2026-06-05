"use client";

// Mig 090 — Bank Decline approval queue (owner).
// Pending requests with Approve (→ bill back to due) / Reject
// (→ stays confirmed), plus a recent resolved history.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ACCOUNTS_TOKENS, Money, VendorAvatar } from "../_ui/components";

type ServerResult = { ok: true } | { ok: false; error: string };

export type BankDeclineRow = {
  paymentId: string;
  billId: string;
  billToken: string;
  vendorBillNo: string;
  vendorName: string;
  amount: number;
  reason: string;
  requestedAt: string | null;
  requestedByName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  declineStatus: "pending" | "approved" | "rejected" | null;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BankDeclinesClient({
  pending,
  resolved,
  approveAction,
  rejectAction,
}: {
  pending: BankDeclineRow[];
  resolved: BankDeclineRow[];
  approveAction: (formData: FormData) => Promise<ServerResult>;
  rejectAction: (formData: FormData) => Promise<ServerResult>;
}) {
  // Daksh — resolved history is hidden behind a top-right toggle so
  // the page lands focused on what needs action (pending only).
  const [showResolved, setShowResolved] = useState(false);

  return (
    <section style={{ paddingBottom: 32 }}>
      <header
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "18px 22px",
          marginBottom: 16,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Finance · Owner approval
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: "2px 0 4px", color: "var(--text)" }}>
            🏦 Bank Declines
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
            The accountant flagged these already-sent payments as refused by the
            bank. <strong>Approve</strong> sends the bill back to Due Bills;{" "}
            <strong>Reject</strong> keeps the payment confirmed.
          </p>
        </div>
        {/* Top-right toggle → reveals the resolved history panel. */}
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          style={{
            flexShrink: 0,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: showResolved ? "var(--gold-dark)" : "var(--bg)",
            color: showResolved ? "#fff" : "var(--muted)",
            border: `1px solid ${showResolved ? "var(--gold-dark)" : "var(--border)"}`,
            borderRadius: 8,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          🗂 Resolved
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "1px 7px",
              borderRadius: 999,
              background: showResolved ? "rgba(255,255,255,0.22)" : "var(--surface)",
              color: showResolved ? "#fff" : "var(--text)",
              border: showResolved ? "none" : "1px solid var(--border)",
            }}
          >
            {resolved.length}
          </span>
        </button>
      </header>

      {/* Resolved history — only when the toggle is on. Shows all the
          recent approved (→ due) / rejected (kept) decisions. */}
      {showResolved && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "14px 16px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>
            Recently resolved ({resolved.length})
          </div>
          {resolved.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Nothing resolved yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {resolved.map((r) => (
                <Link
                  key={r.paymentId}
                  href={`/accounts/bills/${r.billId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    flexWrap: "wrap",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                  title="Open this bill"
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      background: r.declineStatus === "approved" ? "rgba(22,163,74,0.12)" : "var(--surface-alt)",
                      color: r.declineStatus === "approved" ? "#15803d" : "var(--muted)",
                      border: `1px solid ${r.declineStatus === "approved" ? "rgba(22,163,74,0.3)" : "var(--border)"}`,
                    }}
                  >
                    {r.declineStatus === "approved" ? "→ Back to due" : "Kept confirmed"}
                  </span>
                  <strong style={{ fontSize: 13 }}>{r.vendorName}</strong>
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
                    {r.billToken}
                  </code>
                  <Money value={r.amount} size="small" tone="muted" />
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                    {fmtDateTime(r.resolvedAt)}
                    {r.resolvedByName ? ` · ${r.resolvedByName}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending queue */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "var(--text)",
          margin: "0 0 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        Awaiting your approval
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            padding: "2px 9px",
            borderRadius: 999,
            background: pending.length > 0 ? "rgba(217,119,6,0.14)" : "var(--surface-alt)",
            color: pending.length > 0 ? "#92400e" : "var(--muted)",
            border: `1px solid ${pending.length > 0 ? "rgba(217,119,6,0.35)" : "var(--border)"}`,
          }}
        >
          {pending.length}
        </span>
      </div>

      {pending.length === 0 ? (
        <div
          style={{
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            padding: "32px 20px",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
            marginBottom: 24,
          }}
        >
          ✓ Nothing pending. New bank-decline requests will appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
          {pending.map((r) => (
            <PendingCard
              key={r.paymentId}
              row={r}
              approveAction={approveAction}
              rejectAction={rejectAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PendingCard({
  row,
  approveAction,
  rejectAction,
}: {
  row: BankDeclineRow;
  approveAction: (formData: FormData) => Promise<ServerResult>;
  rejectAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (fd: FormData) => Promise<ServerResult>, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.paymentId);
      const r = await action(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: "5px solid #d97706",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      {/* Whole info region is a link → opens the bill page. The
          Approve/Reject buttons are siblings outside this link. */}
      <Link
        href={`/accounts/bills/${row.billId}`}
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          flex: 1,
          minWidth: 0,
          textDecoration: "none",
          color: "inherit",
        }}
        title="Open this bill"
      >
        <VendorAvatar name={row.vendorName} size={42} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>{row.vendorName}</strong>
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
              {row.billToken}
            </code>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>
            Bill <code style={{ fontFamily: "ui-monospace, monospace" }}>{row.vendorBillNo}</code>
          </p>
          <div
            style={{
              fontSize: 12,
              color: "#7f1d1d",
              background: "rgba(185,28,28,0.06)",
              border: "1px solid rgba(185,28,28,0.2)",
              borderRadius: 8,
              padding: "6px 10px",
              lineHeight: 1.4,
            }}
          >
            <strong>Reason:</strong> {row.reason || "—"}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
            Flagged {fmtDateTime(row.requestedAt)}
            {row.requestedByName ? ` · ${row.requestedByName}` : ""}
          </p>
        </div>
      </Link>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Payment amount
        </div>
        <Money value={row.amount} size="large" tone="danger" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", justifyContent: "flex-end", marginTop: 6 }}>
        {error && (
          <span style={{ fontSize: 12, color: ACCOUNTS_TOKENS.danger, marginRight: "auto" }}>
            {error}
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              rejectAction,
              `Reject this bank-decline? ${row.vendorName}'s payment (₹${row.amount.toLocaleString(
                "en-IN",
              )}) will STAY confirmed for payment.`,
            )
          }
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "transparent",
            color: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
          }}
        >
          ✕ Reject (keep confirmed)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              approveAction,
              `Approve this bank-decline? ${row.vendorName}'s payment (₹${row.amount.toLocaleString(
                "en-IN",
              )}, bill ${row.billToken}) will be cancelled and the bill goes back to Due Bills.`,
            )
          }
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "#15803d",
            color: "#fff",
            border: "1px solid #166534",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
          }}
        >
          ✓ Approve → back to due
        </button>
      </div>
    </div>
  );
}
