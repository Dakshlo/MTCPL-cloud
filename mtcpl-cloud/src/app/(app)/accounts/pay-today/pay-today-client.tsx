"use client";

/**
 * Pay-today client UI — two interactive sections.
 *
 * Proposed rows
 *   - Owner sees a per-row checkbox + a single "Confirm batch" button
 *     per batch_id. Un-ticked rows in the same batch get auto-cancelled
 *     by the server action (cancel_reason='owner_unticked').
 *   - Accountant sees rows read-only with a "withdraw proposal" link.
 *
 * Confirmed rows
 *   - Accountant sees an inline expand per row: paid_amount (default =
 *     proposed_amount, can be lowered for partial), payment method,
 *     reference, optional note. Submit → markPaymentPaidAction.
 *   - Owner sees rows read-only.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
};

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
  // Group proposed rows by batch — owner confirms per batch.
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 18 }}>
      {/* Proposed */}
      <Section
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
      </Section>

      {/* Confirmed */}
      <Section
        title="Confirmed — ready to pay"
        emoji="✅"
        emptyMessage="Nothing confirmed yet. Confirmed proposals from the owner land here."
        count={confirmedRows.length}
        total={confirmedRows.reduce((s, r) => s + r.proposedAmount, 0)}
      >
        {confirmedRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {confirmedRows.map((row) => (
              <ConfirmedRow
                key={row.id}
                row={row}
                canMarkPaid={canMarkPaid}
                canCancel={canCancel}
                markPaidAction={markPaidAction}
                cancelAction={cancelAction}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
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
          paddingBottom: 6,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
          {emoji} {title}
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {count} payment{count === 1 ? "" : "s"}
        </span>
        {count > 0 && (
          <span
            style={{
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: "var(--gold-dark)",
              fontWeight: 700,
            }}
          >
            ₹{total.toLocaleString("en-IN")}
          </span>
        )}
      </div>
      {count === 0 ? (
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
  // Default: all rows ticked
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
    startTransition(async () => {
      const fd = new FormData();
      fd.set("batch_id", batchId === "unbatched" ? "" : batchId);
      fd.set("confirmed_payment_ids", JSON.stringify([...confirmedIds]));
      if (batchId === "unbatched") {
        setError(
          "This batch is missing a batch_id (legacy data). Contact a developer.",
        );
        return;
      }
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
        padding: "12px 14px",
        background: "var(--bg)",
        border: "1.5px solid var(--gold)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 13 }}>Batch</strong>
        <code style={{ fontSize: 11, color: "var(--muted)" }}>{batchId.slice(0, 8)}</code>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} bill{rows.length === 1 ? "" : "s"} · ₹{total.toLocaleString("en-IN")}
        </span>
        {rows[0]?.proposedAt && (
          <span className="muted" style={{ fontSize: 11 }}>
            Proposed{" "}
            {new Date(rows[0].proposedAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {rows[0].proposedByName ? ` by ${rows[0].proposedByName}` : ""}
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {canConfirm && <th style={thStyle}>&nbsp;</th>}
              <th style={thStyle}>Token</th>
              <th style={thStyle}>Vendor</th>
              <th style={thStyle}>Bill no</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Outstanding</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Propose ₹</th>
              <th style={thStyle}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                {canConfirm && (
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={confirmedIds.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td style={tdStyle}>
                  <Link
                    href={`/accounts/bills/${r.billId}`}
                    style={{
                      textDecoration: "none",
                      fontWeight: 700,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--text)",
                    }}
                  >
                    {r.billToken}
                  </Link>
                </td>
                <td style={tdStyle}>{r.vendorName}</td>
                <td style={tdStyle}>
                  <code style={{ fontSize: 12 }}>{r.vendorBillNo}</code>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  ₹{r.billOutstanding.toLocaleString("en-IN")}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  <strong style={{ color: "var(--gold-dark)" }}>
                    ₹{r.proposedAmount.toLocaleString("en-IN")}
                  </strong>
                </td>
                <td style={tdStyle}>
                  {!canConfirm && canCancel && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => withdraw(r.id)}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: "transparent",
                        border: "1px dashed var(--border)",
                        borderRadius: 4,
                        color: "var(--muted)",
                        cursor: pending ? "wait" : "pointer",
                      }}
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
            marginTop: 10,
            padding: "8px 10px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid #dc2626",
            borderRadius: 4,
            color: "#7f1d1d",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {canConfirm && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {confirmedIds.size}/{rows.length} ticked ·{" "}
            <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
              ₹{confirmedTotal.toLocaleString("en-IN")}
            </strong>
          </span>
          <button
            type="button"
            onClick={runConfirm}
            disabled={pending}
            className="primary-button"
            style={{ fontSize: 13, fontWeight: 700, padding: "8px 18px" }}
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
  markPaidAction,
  cancelAction,
}: {
  row: PayTodayRow;
  canMarkPaid: boolean;
  canCancel: boolean;
  markPaidAction: (formData: FormData) => Promise<ServerResult>;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [paidAmount, setPaidAmount] = useState<string>(String(row.proposedAmount));
  const [method, setMethod] = useState<string>("neft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  function runPay() {
    setError(null);
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
      setOpen(false);
      router.refresh();
    });
  }

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
        background: "var(--bg)",
        border: "1.5px solid #86efac",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/accounts/bills/${row.billId}`}
          style={{
            textDecoration: "none",
            fontFamily: "ui-monospace, monospace",
            fontWeight: 700,
            color: "var(--text)",
            fontSize: 14,
          }}
        >
          {row.billToken}
        </Link>
        <strong style={{ fontSize: 14 }}>{row.vendorName}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          Bill no <code style={{ fontSize: 11 }}>{row.vendorBillNo}</code>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "ui-monospace, monospace", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>
            Confirmed amount
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#15803d" }}>
            ₹{row.proposedAmount.toLocaleString("en-IN")}
          </div>
        </span>
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
        Outstanding on bill: ₹{row.billOutstanding.toLocaleString("en-IN")}{" "}
        {row.confirmedAt && (
          <>
            · Confirmed{" "}
            {new Date(row.confirmedAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {row.confirmedByName ? ` by ${row.confirmedByName}` : ""}
          </>
        )}
      </p>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid #dc2626",
            borderRadius: 4,
            color: "#7f1d1d",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {canMarkPaid && !open && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="primary-button"
            style={{ fontSize: 13, fontWeight: 700, padding: "8px 18px" }}
          >
            💸 Mark paid
          </button>
          {canCancel && (
            <button
              type="button"
              onClick={runCancel}
              disabled={pending}
              style={{
                fontSize: 12,
                padding: "8px 14px",
                background: "transparent",
                border: "1px dashed var(--border)",
                borderRadius: 6,
                color: "var(--muted)",
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Abort
            </button>
          )}
        </div>
      )}

      {canMarkPaid && open && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          <Field label="Amount paid (₹)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              style={inputStyle}
              required
            />
          </Field>
          <Field label="Method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="neft">NEFT</option>
              <option value="rtgs">RTGS</option>
              <option value="upi">UPI</option>
              <option value="imps">IMPS</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Reference (cheque no / UTR / UPI txn)">
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UTR1234567890"
              style={inputStyle}
            />
          </Field>
          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="any remarks"
              style={inputStyle}
            />
          </Field>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              style={{
                fontSize: 13,
                padding: "8px 14px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--muted)",
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runPay}
              disabled={pending}
              className="primary-button"
              style={{ fontSize: 13, fontWeight: 700, padding: "8px 18px" }}
            >
              {pending ? "Saving…" : "✓ Record payment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "ui-monospace, monospace",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "middle",
};
