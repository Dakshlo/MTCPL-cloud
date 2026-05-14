"use client";

/**
 * Pay-today client UI.
 *
 * Proposed rows
 *   - Owner sees a per-row checkbox + a single "Confirm batch" button
 *     per batch_id. Un-ticked rows in the same batch get auto-cancelled
 *     by the server action.
 *   - Accountant sees rows read-only with a "withdraw proposal" link.
 *
 * Confirmed rows
 *   - Accountant clicks "💸 Mark paid" → opens a right-side slide-over
 *     with paid_amount / method / reference / note.
 *   - Owner sees rows read-only.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  Money,
  PaymentStatusPill,
  SidePanel,
  TABLE_STYLES,
  VendorIdentity,
  VendorAvatar,
} from "../_ui/components";

export type PayTodayRow = {
  id: string;
  billId: string;
  status: "proposed" | "confirmed";
  proposedAmount: number;
  proposedByName: string | null;
  proposedAt: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  batchId: string | null;
  vendorName: string;
  billToken: string;
  vendorBillNo: string;
  billDate: string | null;
  billOutstanding: number;
  billTotal: number;
  /** Mig 040 — per-vendor payment terms. Set in the page server
   *  component from bill_date + vendor.payment_terms_days. */
  daysSinceBill: number | null;
  prematureForPayment: boolean;
  /** The vendor's terms in days (or the app default 45 fallback). */
  paymentTermsDays: number;
};

/** Legacy app-level default — only used as a fallback when a vendor
 *  hasn't set its own payment_terms_days. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 45;

type ServerResult = { ok: true } | { ok: false; error: string };

export function PayTodayClient({
  proposedRows,
  confirmedRows,
  canConfirm,
  canMarkPaid,
  canCancel,
  confirmAction,
  markPaidAction,
  cancelAction,
}: {
  proposedRows: PayTodayRow[];
  confirmedRows: PayTodayRow[];
  canConfirm: boolean;
  canMarkPaid: boolean;
  canCancel: boolean;
  confirmAction: (formData: FormData) => Promise<ServerResult>;
  markPaidAction: (formData: FormData) => Promise<ServerResult>;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const proposedBatches = useMemo(() => {
    const map = new Map<string, PayTodayRow[]>();
    for (const r of proposedRows) {
      const key = r.batchId ?? "unbatched";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()].map(([batchId, rows]) => ({ batchId, rows }));
  }, [proposedRows]);

  const [activeMarkRow, setActiveMarkRow] = useState<PayTodayRow | null>(null);

  // Daksh's 45-day rule — count premature rows across both sections so
  // the warning banner is visible regardless of which step the payment
  // is at (proposed or confirmed).
  const prematureRows = [...proposedRows, ...confirmedRows].filter(
    (r) => r.prematureForPayment,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {prematureRows.length > 0 && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            background: "rgba(251, 191, 36, 0.10)",
            border: "1.5px solid #f59e0b",
            borderLeft: "5px solid #b45309",
            borderRadius: 10,
            fontSize: 13,
            color: "#78350f",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>
              {prematureRows.length} payment{prematureRows.length === 1 ? "" : "s"} below vendor payment terms
            </strong>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
              Each vendor's terms (Vendor Account → payment terms) determine
              when bills become payable. You can still mark these paid, but
              please double-check before releasing the money. Bills affected:{" "}
              {prematureRows
                .slice(0, 6)
                .map(
                  (r) =>
                    `${r.vendorName} (${r.daysSinceBill}d / terms ${r.paymentTermsDays}d)`,
                )
                .join(", ")}
              {prematureRows.length > 6 ? `, and ${prematureRows.length - 6} more` : ""}.
            </div>
          </div>
        </div>
      )}

      {/* Proposed section */}
      <SectionBlock
        title="Proposed"
        emoji="📥"
        emptyMessage={
          canConfirm
            ? "No proposals waiting for confirmation."
            : "Accountant hasn't proposed any payments yet. Open Due Bills to propose."
        }
        count={proposedRows.length}
        total={proposedRows.reduce((s, r) => s + r.proposedAmount, 0)}
      >
        {proposedBatches.map((batch) => (
          <ProposedBatch
            key={batch.batchId}
            batchId={batch.batchId}
            rows={batch.rows}
            canConfirm={canConfirm}
            canCancel={canCancel}
            confirmAction={confirmAction}
            cancelAction={cancelAction}
          />
        ))}
      </SectionBlock>

      {/* Confirmed section */}
      <SectionBlock
        title="Confirmed — ready to pay"
        emoji="✅"
        emptyMessage="Nothing confirmed yet. Confirmed proposals from the owner land here."
        count={confirmedRows.length}
        total={confirmedRows.reduce((s, r) => s + r.proposedAmount, 0)}
      >
        {confirmedRows.length > 0 && (
          <>
            {/* HDFC bulk-payment Excel download — Daksh's bank
                accepts an .xlsx with all beneficiary + amount info
                in one upload. Generated from every CONFIRMED row
                with the per-vendor bank details we already store.
                Plain <a> with download attribute so the browser
                handles the .xlsx response directly. */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: 10,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <a
                href="/api/accounts/hdfc-payment-export"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: "#fff",
                  color: "#1e293b",
                  border: "1.5px solid #1e3a5f",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                }}
                title="Download an HDFC-compatible bulk-payment Excel for every confirmed row. Upload it in your HDFC NetBanking 'Bulk Upload' screen to release all payments in one go."
              >
                📥 Download HDFC bulk-payment Excel
              </a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {confirmedRows.map((row) => (
                <ConfirmedRow
                  key={row.id}
                  row={row}
                  canMarkPaid={canMarkPaid}
                  canCancel={canCancel}
                  cancelAction={cancelAction}
                  onMarkPaid={() => setActiveMarkRow(row)}
                />
              ))}
            </div>
          </>
        )}
      </SectionBlock>

      {/* Mark-paid slide-over */}
      <SidePanel
        open={activeMarkRow !== null}
        onClose={() => setActiveMarkRow(null)}
        title={
          activeMarkRow ? (
            <span>
              Mark paid · <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: ACCOUNTS_TOKENS.accent }}>{activeMarkRow.billToken}</code>
            </span>
          ) : (
            "Mark paid"
          )
        }
        description={
          activeMarkRow
            ? `${activeMarkRow.vendorName} · Confirmed ₹${activeMarkRow.proposedAmount.toLocaleString("en-IN")} · Outstanding ₹${activeMarkRow.billOutstanding.toLocaleString("en-IN")}`
            : undefined
        }
      >
        {activeMarkRow && (
          <MarkPaidForm
            row={activeMarkRow}
            markPaidAction={markPaidAction}
            onSuccess={() => setActiveMarkRow(null)}
          />
        )}
      </SidePanel>
    </div>
  );
}

function SectionBlock({
  title,
  emoji,
  emptyMessage,
  count,
  total,
  children,
}: {
  title: string;
  emoji: string;
  emptyMessage: string;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
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
          <strong style={{ color: "var(--text)" }}>{count}</strong>{" "}
          payment{count === 1 ? "" : "s"}
          {count > 0 && (
            <>
              {" · "}
              <Money value={total} size="small" tone="accent" />
            </>
          )}
        </span>
      </div>
      {count === 0 ? (
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
        children
      )}
    </div>
  );
}

function ProposedBatch({
  batchId,
  rows,
  canConfirm,
  canCancel,
  confirmAction,
  cancelAction,
}: {
  batchId: string;
  rows: PayTodayRow[];
  canConfirm: boolean;
  canCancel: boolean;
  confirmAction: (formData: FormData) => Promise<ServerResult>;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(
    () => new Set(rows.map((r) => r.id)),
  );

  function toggle(id: string) {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runConfirm() {
    setError(null);
    if (batchId === "unbatched") {
      setError("This batch is missing a batch_id (legacy data). Contact a developer.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("batch_id", batchId);
      fd.set("confirmed_payment_ids", JSON.stringify([...confirmedIds]));
      const r = await confirmAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function withdraw(rowId: string) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", rowId);
      fd.set("cancel_reason", "accountant_withdrew");
      const r = await cancelAction(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const total = rows.reduce((s, r) => s + r.proposedAmount, 0);
  const confirmedTotal = rows
    .filter((r) => confirmedIds.has(r.id))
    .reduce((s, r) => s + r.proposedAmount, 0);

  return (
    <div
      style={{
        marginBottom: 14,
        background: "#fff",
        border: `1.5px solid ${ACCOUNTS_TOKENS.accent}`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        overflow: "hidden",
      }}
    >
      {/* Batch header */}
      <div
        style={{
          padding: "12px 16px",
          background: ACCOUNTS_TOKENS.accentLight,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: ACCOUNTS_TOKENS.accent,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Batch
        </div>
        <code style={{ fontSize: 11, color: ACCOUNTS_TOKENS.accent, fontFamily: "ui-monospace, monospace" }}>
          {batchId.slice(0, 8)}
        </code>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {rows.length} bill{rows.length === 1 ? "" : "s"} ·{" "}
          <Money value={total} size="small" tone="accent" />
        </span>
        {rows[0]?.proposedAt && (
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
            Proposed{" "}
            {new Date(rows[0].proposedAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {rows[0].proposedByName ? ` · ${rows[0].proposedByName}` : ""}
          </span>
        )}
      </div>

      {/* Rows */}
      <div style={{ overflowX: "auto" }}>
        <table style={TABLE_STYLES.table}>
          <thead style={TABLE_STYLES.thead}>
            <tr>
              {canConfirm && <th style={{ ...TABLE_STYLES.th, width: 40 }}>&nbsp;</th>}
              <th style={TABLE_STYLES.th}>Vendor / token</th>
              <th style={TABLE_STYLES.th}>Bill no</th>
              <th style={TABLE_STYLES.thRight}>Outstanding</th>
              <th style={TABLE_STYLES.thRight}>Proposed</th>
              <th style={TABLE_STYLES.th}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canConfirm && (
                  <td style={TABLE_STYLES.td}>
                    <input
                      type="checkbox"
                      checked={confirmedIds.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td style={TABLE_STYLES.td}>
                  <Link href={`/accounts/bills/${r.billId}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <VendorIdentity name={r.vendorName} subLabel={r.billToken} />
                  </Link>
                </td>
                <td style={TABLE_STYLES.td}>
                  <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                    {r.vendorBillNo}
                  </code>
                </td>
                <td style={TABLE_STYLES.tdRight}>
                  <Money value={r.billOutstanding} tone="muted" />
                </td>
                <td style={TABLE_STYLES.tdRight}>
                  <Money value={r.proposedAmount} tone="accent" />
                </td>
                <td style={TABLE_STYLES.td}>
                  {!canConfirm && canCancel && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => withdraw(r.id)}
                      style={BUTTON_STYLES.ghost}
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            margin: "0 16px 12px",
            padding: "8px 10px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 6,
            color: ACCOUNTS_TOKENS.danger,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {canConfirm && (
        <div
          style={{
            padding: "12px 16px",
            background: ACCOUNTS_TOKENS.surfaceMuted,
            borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{confirmedIds.size}</strong>/{rows.length} ticked ·{" "}
            <Money value={confirmedTotal} size="small" tone="accent" />
          </span>
          <button
            type="button"
            onClick={runConfirm}
            disabled={pending}
            style={BUTTON_STYLES.primary}
          >
            {pending ? "Confirming…" : "✓ Confirm this batch"}
          </button>
        </div>
      )}
    </div>
  );
}

function ConfirmedRow({
  row,
  canMarkPaid,
  canCancel,
  cancelAction,
  onMarkPaid,
}: {
  row: PayTodayRow;
  canMarkPaid: boolean;
  canCancel: boolean;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
  onMarkPaid: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runCancel() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      fd.set("cancel_reason", "aborted_before_pay");
      const r = await cancelAction(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div
      style={{
        background: "#fff",
        border: `1.5px solid ${ACCOUNTS_TOKENS.success}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: ACCOUNTS_TOKENS.shadow,
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
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
            <PaymentStatusPill status={row.status} />
          </div>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--muted)" }}>
            Bill <code style={{ fontFamily: "ui-monospace, monospace" }}>{row.vendorBillNo}</code>
            {" · Outstanding "}
            <Money value={row.billOutstanding} size="small" tone="muted" />
          </p>
          {row.confirmedAt && (
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
              Confirmed{" "}
              {new Date(row.confirmedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {row.confirmedByName ? ` · ${row.confirmedByName}` : ""}
            </p>
          )}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Confirmed amount
        </div>
        <Money value={row.proposedAmount} size="large" tone="success" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", justifyContent: "flex-end", marginTop: 6 }}>
        {error && (
          <span style={{ fontSize: 12, color: ACCOUNTS_TOKENS.danger, marginRight: "auto" }}>
            {error}
          </span>
        )}
        {canMarkPaid && (
          <button type="button" onClick={onMarkPaid} style={BUTTON_STYLES.primary}>
            💸 Mark paid
          </button>
        )}
        {canCancel && (
          <button type="button" onClick={runCancel} disabled={pending} style={BUTTON_STYLES.ghost}>
            Abort
          </button>
        )}
      </div>
    </div>
  );
}

function MarkPaidForm({
  row,
  markPaidAction,
  onSuccess,
}: {
  row: PayTodayRow;
  markPaidAction: (formData: FormData) => Promise<ServerResult>;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [paidAmount, setPaidAmount] = useState<string>(String(row.proposedAmount));
  const [method, setMethod] = useState<string>("neft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const paidNum = Number(paidAmount) || 0;
  const isPartial = paidNum > 0 && paidNum < row.proposedAmount;
  const exceedsOutstanding = paidNum > row.billOutstanding;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (paidNum <= 0) return setError("Paid amount must be greater than zero.");
    if (exceedsOutstanding) {
      return setError(
        `Paid amount exceeds the bill's outstanding ₹${row.billOutstanding.toLocaleString("en-IN")}.`,
      );
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      fd.set("paid_amount", paidAmount);
      fd.set("payment_method", method);
      fd.set("payment_reference", reference.trim());
      fd.set("payment_note", note.trim());
      const r = await markPaidAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onSuccess();
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Quick summary */}
      <div
        style={{
          padding: "12px 14px",
          background: ACCOUNTS_TOKENS.surfaceMuted,
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Bill outstanding
        </div>
        <Money value={row.billOutstanding} size="large" tone="warning" />
      </div>

      <Field label="Amount paid" required>
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              pointerEvents: "none",
            }}
          >
            ₹
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
            style={{
              ...INPUT_STYLE,
              paddingLeft: 26,
              fontFamily: "ui-monospace, monospace",
              fontSize: 16,
              fontWeight: 700,
            }}
            required
          />
        </div>
        {isPartial && (
          <span style={{ fontSize: 11, color: ACCOUNTS_TOKENS.warning, fontWeight: 600, marginTop: 4 }}>
            Partial payment — ₹{(row.proposedAmount - paidNum).toLocaleString("en-IN")} of the proposed amount remains in outstanding.
          </span>
        )}
        {exceedsOutstanding && (
          <span style={{ fontSize: 11, color: ACCOUNTS_TOKENS.danger, fontWeight: 600, marginTop: 4 }}>
            Exceeds outstanding ₹{row.billOutstanding.toLocaleString("en-IN")}.
          </span>
        )}
      </Field>

      <Field label="Payment method" required>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[
            { v: "cash", l: "Cash" },
            { v: "cheque", l: "Cheque" },
            { v: "neft", l: "NEFT" },
            { v: "rtgs", l: "RTGS" },
            { v: "upi", l: "UPI" },
            { v: "imps", l: "IMPS" },
            { v: "card", l: "Card" },
            { v: "other", l: "Other" },
          ].map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setMethod(m.v)}
              style={{
                padding: "8px 10px",
                fontSize: 12,
                fontWeight: 600,
                background: method === m.v ? ACCOUNTS_TOKENS.accent : "#fff",
                color: method === m.v ? "#fff" : "var(--text)",
                border: `1px solid ${method === m.v ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {m.l}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Reference (cheque no / UTR / UPI txn)">
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. UTR1234567890"
          style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
        />
      </Field>

      <Field label="Note (optional)">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="any remarks"
          style={INPUT_STYLE}
        />
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" onClick={onSuccess} disabled={pending} style={BUTTON_STYLES.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={pending || exceedsOutstanding} style={BUTTON_STYLES.primary}>
          {pending ? "Saving…" : "✓ Record payment"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
        {required && <span style={{ color: ACCOUNTS_TOKENS.danger, marginLeft: 4 }}>*</span>}
      </span>
      {children}
    </label>
  );
}
