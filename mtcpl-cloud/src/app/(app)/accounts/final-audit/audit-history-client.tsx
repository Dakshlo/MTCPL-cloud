"use client";

/**
 * Mig 082 follow-on (Daksh, June 2026) — dedicated list view of
 * audited payments (verified OR flagged). The parent route picks
 * which status to query and renders this component with the
 * matching rows.
 *
 * Built as a client component so the date filter (today /
 * yesterday / last 7 days) can re-bucket the in-memory list
 * without a server round trip. Date filter logic mirrors the
 * IST-aware comparisons used elsewhere in /accounts.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FinalAuditRow } from "./final-audit-client";
import { ACCOUNTS_TOKENS, Money, VendorAvatar } from "../_ui/components";

type DateRange = "today" | "yesterday" | "last_7d" | "all";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function startOfDayIstMs(d: Date): number {
  const ist = d.getTime() + IST_OFFSET_MS;
  const startUtc = Math.floor(ist / DAY_MS) * DAY_MS;
  return startUtc - IST_OFFSET_MS;
}

export function AuditHistoryClient({
  rows,
  variant,
  canSettle = false,
}: {
  rows: FinalAuditRow[];
  /** Drives the heading + the empty-state copy + the row pill colour.
   *  Same data shape either way; just different intent. */
  variant: "verified" | "flagged";
  /** Mig 085 — when true (auditor / owner / dev on the flagged list),
   *  open flagged cards get a "Settle with debit" button. */
  canSettle?: boolean;
}) {
  const [range, setRange] = useState<DateRange>("today");
  // Mig 085 follow-on (Daksh, June 2026) — the flagged variant gets a
  // Flagged / Settled tab split. Approved debits leave the working
  // queue and live under their own "Settled with debit" tab so the
  // owner can keep track without them cluttering the action list.
  const [tab, setTab] = useState<"flagged" | "settled">("flagged");

  // Filter rows by audited_at against the selected IST date window.
  const filteredRows = useMemo(() => {
    if (range === "all") return rows;
    const todayStart = startOfDayIstMs(new Date());
    const yesterdayStart = todayStart - DAY_MS;
    const sevenAgoStart = todayStart - 7 * DAY_MS;
    return rows.filter((r) => {
      if (!r.auditedAt) return false;
      const t = new Date(r.auditedAt).getTime();
      if (range === "today") return t >= todayStart;
      if (range === "yesterday") return t >= yesterdayStart && t < todayStart;
      // last_7d — includes today and the previous 6 days.
      return t >= sevenAgoStart;
    });
  }, [rows, range]);

  // A flagged payment is "settled" once its debit is APPROVED
  // (debit_settled_at stamped / settlement approved). A "pending"
  // debit (awaiting owner approval) stays in the working list but
  // shows an "in approval" chip instead of the Settle button.
  const isSettled = (r: FinalAuditRow) =>
    r.debitState === "settled" || !!r.debitSettledAt;
  const settledRows =
    variant === "flagged" ? filteredRows.filter(isSettled) : [];
  const workingRows =
    variant === "flagged"
      ? filteredRows.filter((r) => !isSettled(r))
      : filteredRows;
  const displayRows =
    variant === "flagged" && tab === "settled" ? settledRows : workingRows;

  const totalAmount = displayRows.reduce(
    (sum, r) => sum + (r.paidAmount ?? 0),
    0,
  );

  const accent = variant === "verified" ? "#15803d" : "#b91c1c";
  const accentBg = variant === "verified" ? "#dcfce7" : "#fee2e2";
  // On the flagged → Settled tab the tile/count turn green so the two
  // tabs read differently at a glance.
  const onSettledTab = variant === "flagged" && tab === "settled";
  const tileAccent = onSettledTab ? "#15803d" : accent;
  const headingLabel =
    variant === "verified"
      ? "Verified bills"
      : onSettledTab
        ? "Settled with debit"
        : "Flagged bills";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Flagged / Settled tab switch — flagged variant only. Keeps the
          approved-debit list out of the owner's working queue. */}
      {variant === "flagged" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              { v: "flagged", label: `🚩 Flagged`, count: workingRows.length, color: "#b91c1c" },
              { v: "settled", label: `✓ Settled with debit`, count: settledRows.length, color: "#15803d" },
            ] as Array<{ v: "flagged" | "settled"; label: string; count: number; color: string }>
          ).map((opt) => {
            const active = opt.v === tab;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setTab(opt.v)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 800,
                  background: active ? opt.color : "#fff",
                  color: active ? "#fff" : "var(--text)",
                  border: `1.5px solid ${active ? opt.color : ACCOUNTS_TOKENS.border}`,
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                {opt.label}
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    fontWeight: 800,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: active ? "rgba(255,255,255,0.25)" : opt.color,
                    color: active ? "#fff" : "#fff",
                  }}
                >
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Total + date filter row */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "stretch",
          flexWrap: "wrap",
          padding: "14px 16px",
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderLeft: `4px solid ${tileAccent}`,
          borderRadius: 10,
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {headingLabel} · {dateRangeLabel(range)}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: tileAccent,
              fontFamily: "ui-monospace, monospace",
              marginTop: 2,
            }}
          >
            {displayRows.length} bill{displayRows.length === 1 ? "" : "s"}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            Total amount:{" "}
            <strong
              style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}
            >
              <Money value={totalAmount} />
            </strong>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {(
            [
              { v: "today", label: "Today" },
              { v: "yesterday", label: "Yesterday" },
              { v: "last_7d", label: "Last 7 days" },
              { v: "all", label: "All" },
            ] as Array<{ v: DateRange; label: string }>
          ).map((opt) => {
            const active = opt.v === range;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setRange(opt.v)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: active ? accent : "#fff",
                  color: active ? "#fff" : "var(--text)",
                  border: `1px solid ${active ? accent : ACCOUNTS_TOKENS.border}`,
                  borderRadius: 999,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* List for the active tab (rows already bucketed above). */}
      {displayRows.length === 0 ? (
        <div
          style={{
            padding: "28px 18px",
            background: "#fff",
            border: `1px dashed ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 10,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          {variant === "flagged"
            ? onSettledTab
              ? "No debits settled in this window."
              : "No flagged payments in this window."
            : "No verified payments in this window."}
        </div>
      ) : (
        displayRows.map((row) => (
          <AuditHistoryRow
            key={row.id}
            row={row}
            accent={onSettledTab ? "#15803d" : accent}
            accentBg={onSettledTab ? "#dcfce7" : accentBg}
            canSettle={canSettle}
            debitState={
              isSettled(row)
                ? "settled"
                : row.debitState === "pending"
                  ? "pending"
                  : "open"
            }
          />
        ))
      )}
    </div>
  );
}

function dateRangeLabel(r: DateRange): string {
  switch (r) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last_7d":
      return "Last 7 days";
    case "all":
      return "All time";
  }
}

function AuditHistoryRow({
  row,
  accent,
  accentBg,
  canSettle,
  debitState,
}: {
  row: FinalAuditRow;
  accent: string;
  accentBg: string;
  canSettle: boolean;
  /** "open" → show the Settle button. "pending" → a debit is awaiting
   *  owner approval, show an "in approval" chip (no button — blocks a
   *  second accidental request). "settled" → approved, green chip. */
  debitState: "open" | "pending" | "settled";
}) {
  const auditedAtLabel = row.auditedAt
    ? new Date(row.auditedAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: ACCOUNTS_TOKENS.shadow,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <VendorAvatar name={row.vendorName} size={42} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 4,
              }}
            >
              {/* Vendor name → vendor account page (matches the
                  Final Audit queue). Carries `from=final-audit` so
                  the vendor page surfaces the back-button. */}
              {row.vendorId ? (
                <Link
                  href={`/accounts/vendors/${row.vendorId}?from=final-audit`}
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text)",
                    textDecoration: "none",
                  }}
                >
                  {row.vendorName}
                </Link>
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {row.vendorName}
                </span>
              )}
              <Link
                href={`/accounts/bills/${row.billId}`}
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  padding: "2px 8px",
                  background: ACCOUNTS_TOKENS.accentLight,
                  color: ACCOUNTS_TOKENS.accent,
                  borderRadius: 4,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                {row.billToken}
              </Link>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: accentBg,
                  color: accent,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {row.auditStatus === "verified" ? "✓ Verified" : "🚩 Flagged"}
              </span>
            </div>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>
              Bill{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {row.vendorBillNo}
              </code>
              {row.paymentReference && (
                <>
                  {" · "}UTR{" "}
                  <code style={{ fontFamily: "ui-monospace, monospace" }}>
                    {row.paymentReference}
                  </code>
                </>
              )}
              {row.paymentMethod && <> · {row.paymentMethod}</>}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
              {row.auditStatus === "verified" ? "Verified" : "Flagged"} by{" "}
              {row.auditedByName ?? "Unknown"} · {auditedAtLabel}
            </p>
            {row.flagReason && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12,
                  color: accent,
                  fontWeight: 600,
                }}
              >
                Reason: {row.flagReason}
                {row.flagNote ? ` — ${row.flagNote}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Paid amount
        </div>
        {/* precise=true — paid_amount must tie out to the bank
            statement to the paise, same posture as the main audit
            queue card. */}
        <Money value={row.paidAmount} size="large" tone="success" precise />

        {/* Mig 085 — settle-with-debit affordance. Open rows get the
            button; a debit "in approval" shows an amber chip (no button,
            so the same flag can't be sent for a second debit); settled
            rows show the green confirmation chip. */}
        {debitState === "settled" ? (
          <div
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: 999,
              background: "#dcfce7",
              color: "#15803d",
            }}
            title={
              row.debitSettledAt
                ? `Settled ${new Date(row.debitSettledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Settled with debit"
            }
          >
            ✓ Settled with debit
          </div>
        ) : debitState === "pending" ? (
          <div
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 800,
              padding: "5px 10px",
              borderRadius: 999,
              background: "#fef3c7",
              color: "#92400e",
              border: "1px solid #f59e0b",
            }}
            title="A debit for this bill is waiting for owner approval — you can't start another one until it's approved or rejected."
          >
            ⏳ Debit in approval
            {typeof row.debitAmount === "number" && row.debitAmount > 0 && (
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                · ₹{Math.round(row.debitAmount).toLocaleString("en-IN")}
              </span>
            )}
          </div>
        ) : (
          canSettle && (
            <div style={{ marginTop: 10 }}>
              <Link
                href={`/accounts/final-audit/flagged/${row.id}/settle`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 800,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: ACCOUNTS_TOKENS.accent,
                  color: "#fff",
                  textDecoration: "none",
                  boxShadow: ACCOUNTS_TOKENS.shadow,
                }}
              >
                ⇄ Settle with debit
              </Link>
            </div>
          )
        )}
      </div>
    </div>
  );
}
