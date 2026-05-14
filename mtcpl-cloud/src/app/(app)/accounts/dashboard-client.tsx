"use client";

/**
 * Due-bills table + multi-select propose-pay-today.
 *
 * Modern Zoho-style layout: sticky action bar at the bottom shows
 * selected count + grand total + propose button. Per-row "propose ₹"
 * input is collapsed by default — appears only after the row is
 * ticked. Sticky table header, hover rows, vendor avatars.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "./_ui/components";

export type DueBillRow = {
  id: string;
  token: string;
  vendorId: string;
  vendorName: string;
  vendorBillNo: string;
  billDate: string;
  description: string;
  costHead: string | null;
  amountTotal: number;
  amountPaid: number;
  amountOutstanding: number;
  ageBucket: "0_30" | "31_60" | "61_90" | "90_plus";
  hasOpenPayment: boolean;
  /** Days since bill_date. Used for the premature-payment guard. */
  daysSinceBill: number;
  /** Per-vendor payment terms (Mig 040): bills younger than this
   *  vendor's terms shouldn't be paid yet. Soft warning, not a hard
   *  block. Pre-Mig-040 vendors fall back to the app default (45). */
  prematureForPayment: boolean;
  /** The vendor's actual terms in days — used for the warning text
   *  ("Pay after 30d" varies per vendor now). */
  paymentTermsDays: number;
  /** When the bill was approved by the crosscheck role (or owner) —
   *  shows in the Due Bills table so the accountant can see how long
   *  it has been verified. NULL for legacy bills approved before the
   *  Mig 027 timestamp field was added. */
  crosscheckedAt: string | null;
  /** Breakdown of paid payments for this bill. Empty if nothing paid
   *  yet. Used to render chips under the Paid column. */
  paymentParts: Array<{
    amount: number;
    paidAt: string | null;
    method: string | null;
  }>;
};

/** Legacy global default — kept for back-compat with code paths that
 *  haven't moved to per-vendor terms yet. Vendors that have an
 *  explicit payment_terms_days override this. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 45;

type ProposeResult =
  | { ok: true; batchId: string; rowsCreated: number; skipped: string[] }
  | { ok: false; error: string };

export function DueBillsClient({
  rows,
  canPropose,
  proposeAction,
}: {
  rows: DueBillRow[];
  canPropose: boolean;
  proposeAction: (formData: FormData) => Promise<ProposeResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amountOverrides, setAmountOverrides] = useState<Record<string, string>>({});

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedTotal = selectedRows.reduce(
    (s, r) => s + (Number(amountOverrides[r.id]) || r.amountOutstanding),
    0,
  );
  // Daksh's 45-day rule — flag any selected rows that are too young
  // to be paid by company policy. Soft warning rendered above the
  // sticky propose bar.
  const prematureSelected = selectedRows.filter((r) => r.prematureForPayment);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    const next = new Set(selected);
    for (const r of rows) if (!r.hasOpenPayment) next.add(r.id);
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Set());
    setAmountOverrides({});
  }

  function handlePropose() {
    setError(null);
    setSuccess(null);
    if (selectedRows.length === 0) return setError("Pick at least one bill.");
    const proposedAmounts: Record<string, number> = {};
    for (const r of selectedRows) {
      const override = Number(amountOverrides[r.id]);
      proposedAmounts[r.id] =
        Number.isFinite(override) && override > 0
          ? Math.min(override, r.amountOutstanding)
          : r.amountOutstanding;
    }
    const fd = new FormData();
    fd.set("bill_ids", JSON.stringify(selectedRows.map((r) => r.id)));
    fd.set("proposed_amounts", JSON.stringify(proposedAmounts));
    startTransition(async () => {
      const r = await proposeAction(fd);
      if (!r.ok) return setError(r.error);
      setSelected(new Set());
      setAmountOverrides({});
      setSuccess(
        `${r.rowsCreated} bill${r.rowsCreated === 1 ? "" : "s"} proposed${
          r.skipped.length > 0 ? ` · ${r.skipped.length} skipped` : ""
        }. Owner can confirm on Pay Today.`,
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return null; // EmptyState rendered by the parent server component
  }

  return (
    <div style={{ position: "relative" }}>
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "10px 14px",
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
      {success && (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.successLight,
            border: `1px solid ${ACCOUNTS_TOKENS.success}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.success,
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>{success}</span>
          <Link
            href="/accounts/pay-today"
            style={{ ...BUTTON_STYLES.secondary, padding: "6px 12px", fontSize: 12 }}
          >
            Open Pay Today →
          </Link>
        </div>
      )}

      <div style={TABLE_STYLES.tableWrap}>
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLES.table}>
            <thead style={TABLE_STYLES.thead}>
              <tr>
                {canPropose && (
                  <th style={{ ...TABLE_STYLES.th, width: 40 }}>
                    <input
                      type="checkbox"
                      checked={
                        rows.length > 0 &&
                        rows.every((r) => r.hasOpenPayment || selected.has(r.id))
                      }
                      onChange={(e) =>
                        e.currentTarget.checked ? selectAllVisible() : clearAll()
                      }
                    />
                  </th>
                )}
                <th style={TABLE_STYLES.th}>Vendor / token</th>
                <th style={TABLE_STYLES.th}>Bill #</th>
                <th style={TABLE_STYLES.th}>Bill date</th>
                <th style={TABLE_STYLES.th}>Cost head</th>
                <th style={TABLE_STYLES.thRight}>Total</th>
                <th style={TABLE_STYLES.thRight}>Paid</th>
                <th style={TABLE_STYLES.thRight}>Outstanding</th>
                <th style={TABLE_STYLES.th}>Age / Verified</th>
                {canPropose && <th style={TABLE_STYLES.thRight}>Propose</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isSelected = selected.has(r.id);
                const display =
                  amountOverrides[r.id] != null
                    ? amountOverrides[r.id]
                    : String(r.amountOutstanding);
                return (
                  <tr
                    key={r.id}
                    style={{
                      background: isSelected
                        ? ACCOUNTS_TOKENS.accentLight
                        : idx % 2 === 0
                          ? "#fff"
                          : ACCOUNTS_TOKENS.surfaceMuted,
                      opacity: r.hasOpenPayment ? 0.55 : 1,
                      transition: "background 0.1s",
                    }}
                  >
                    {canPropose && (
                      <td style={TABLE_STYLES.td}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={r.hasOpenPayment}
                          onChange={() => toggle(r.id)}
                          title={
                            r.hasOpenPayment
                              ? "A payment is already in flight for this bill"
                              : undefined
                          }
                        />
                      </td>
                    )}
                    <td style={TABLE_STYLES.td}>
                      <Link
                        href={`/accounts/bills/${r.id}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <VendorIdentity
                          name={r.vendorName}
                          subLabel={r.token}
                          size={32}
                        />
                      </Link>
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                        {r.vendorBillNo}
                      </code>
                    </td>
                    <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                      {new Date(r.billDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      {r.costHead ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: ACCOUNTS_TOKENS.surfaceMuted,
                            color: ACCOUNTS_TOKENS.neutral,
                            fontWeight: 600,
                            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                          }}
                        >
                          {r.costHead}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={r.amountTotal} tone="muted" />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <PaidCell paid={r.amountPaid} parts={r.paymentParts} />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={r.amountOutstanding} tone="warning" />
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <AgeBadge
                        bucket={r.ageBucket}
                        days={r.daysSinceBill}
                        premature={r.prematureForPayment}
                        termsDays={r.paymentTermsDays}
                      />
                      {r.crosscheckedAt && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 10,
                            color: "var(--muted)",
                            fontFamily: "ui-monospace, monospace",
                            whiteSpace: "nowrap",
                          }}
                          title={`Crosschecked at ${new Date(r.crosscheckedAt).toLocaleString("en-IN")}`}
                        >
                          ✅{" "}
                          {new Date(r.crosscheckedAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </div>
                      )}
                    </td>
                    {canPropose && (
                      <td style={TABLE_STYLES.tdRight}>
                        {isSelected ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={r.amountOutstanding}
                            value={display}
                            disabled={r.hasOpenPayment}
                            onChange={(e) => {
                              // Cap at outstanding — can't propose more than
                              // what's owed. Empty string is allowed during
                              // typing so the user can clear and retype.
                              const raw = e.target.value;
                              if (raw === "") {
                                setAmountOverrides((p) => ({ ...p, [r.id]: "" }));
                                return;
                              }
                              const n = Number(raw);
                              if (!Number.isFinite(n) || n < 0) return;
                              const clamped =
                                n > r.amountOutstanding
                                  ? String(r.amountOutstanding)
                                  : raw;
                              setAmountOverrides((p) => ({ ...p, [r.id]: clamped }));
                            }}
                            onBlur={(e) => {
                              // On blur, normalise: empty/0 → outstanding,
                              // otherwise leave the user's number alone.
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n) || n <= 0) {
                                setAmountOverrides((p) => {
                                  const next = { ...p };
                                  delete next[r.id];
                                  return next;
                                });
                              }
                            }}
                            title={`Max ₹${r.amountOutstanding.toLocaleString("en-IN")} — capped at outstanding`}
                            style={{
                              width: 120,
                              padding: "6px 8px",
                              fontSize: 12,
                              fontFamily: "ui-monospace, monospace",
                              border: `1px solid ${ACCOUNTS_TOKENS.accent}`,
                              borderRadius: 6,
                              background: "#fff",
                              color: "var(--text)",
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Premature-payment warning (mig 040: per-vendor terms).
          Renders above the sticky bar when the current selection
          includes any bill younger than its vendor's terms. Soft
          block — user can still proceed if they have a reason. */}
      {canPropose && prematureSelected.length > 0 && (
        <div
          style={{
            marginTop: 14,
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
          role="alert"
        >
          <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">
            ⚠️
          </span>
          <div style={{ flex: 1 }}>
            <strong>
              {prematureSelected.length} bill
              {prematureSelected.length === 1 ? "" : "s"} below vendor payment terms
            </strong>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
              Each vendor's terms (Vendor Account → payment terms) determine
              when bills become payable. You can still propose now, but please
              double-check before sending.
              Bills affected:{" "}
              {prematureSelected
                .map(
                  (r) =>
                    `${r.vendorName} (${r.daysSinceBill}d / terms ${r.paymentTermsDays}d)`,
                )
                .join(", ")}
              .
            </div>
          </div>
        </div>
      )}

      {/* Sticky action bar (sticky when selection is non-empty) */}
      {canPropose && selected.size > 0 && (
        <div
          style={{
            position: "sticky",
            bottom: 16,
            marginTop: 14,
            padding: "14px 18px",
            background: "#fff",
            border: `1.5px solid ${ACCOUNTS_TOKENS.accent}`,
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(79,70,229,0.18)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            zIndex: 5,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {selected.size} bill{selected.size === 1 ? "" : "s"} selected
            </span>
            <Money value={selectedTotal} size="large" tone="accent" />
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={clearAll} style={BUTTON_STYLES.ghost} disabled={pending}>
            Clear
          </button>
          <button
            type="button"
            onClick={handlePropose}
            disabled={pending}
            style={BUTTON_STYLES.primary}
          >
            {pending ? "Proposing…" : `💸 Propose ${selected.size} for Pay Today`}
          </button>
        </div>
      )}
    </div>
  );
}

function AgeBadge({
  bucket,
  days,
  premature,
  termsDays,
}: {
  bucket: DueBillRow["ageBucket"];
  days: number;
  premature?: boolean;
  /** This vendor's payment terms in days. Drives the "Pay after Nd"
   *  countdown text on the premature pill. Falls back to the legacy
   *  45 if not supplied (mostly to keep call sites optional). */
  termsDays?: number;
}) {
  const tints: Record<DueBillRow["ageBucket"], { bg: string; fg: string; dot: string }> = {
    "0_30":    { bg: "#dcfce7", fg: "#166534", dot: "#22c55e" },
    "31_60":   { bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
    "61_90":   { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c" },
    "90_plus": { bg: "#fee2e2", fg: "#991b1b", dot: "#ef4444" },
  };
  const t = tints[bucket];
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px 2px 8px",
          borderRadius: 999,
          background: t.bg,
          color: t.fg,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "ui-monospace, monospace",
        }}
        title={`${days} day${days === 1 ? "" : "s"} since bill date`}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.dot }} />
        {days}d
      </span>
      {premature && (
        <span
          title={`Vendor's terms: ${termsDays ?? DEFAULT_PAYMENT_TERMS_DAYS}d after bill date`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 4,
            background: "rgba(251, 191, 36, 0.15)",
            color: "#92400e",
            border: "1px solid #fbbf24",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          ⚠ Pay after {Math.max(0, (termsDays ?? DEFAULT_PAYMENT_TERMS_DAYS) - days)}d
        </span>
      )}
    </div>
  );
}

/** Paid column cell — total paid figure with a breakdown of the
 *  individual payment chunks underneath (Daksh: "show paid amount in
 *  parts. like 10000 under that 20000 and under that 20000"). If the
 *  bill has no payments yet the cell collapses to a muted dash. */
function PaidCell({
  paid,
  parts,
}: {
  paid: number;
  parts: DueBillRow["paymentParts"];
}) {
  if (paid <= 0 || parts.length === 0) {
    return <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>;
  }
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <Money value={paid} tone="success" />
      {parts.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {parts.map((p, i) => {
            const datePart = p.paidAt
              ? new Date(p.paidAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })
              : null;
            return (
              <span
                key={i}
                title={[
                  `Part #${i + 1}`,
                  datePart ? `Paid on ${datePart}` : null,
                  p.method ? `via ${p.method}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#15803d",
                  background: "rgba(34, 197, 94, 0.10)",
                  border: "1px solid rgba(34, 197, 94, 0.25)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                ₹{p.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                {datePart ? (
                  <span style={{ opacity: 0.7, fontWeight: 500 }}> · {datePart}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
