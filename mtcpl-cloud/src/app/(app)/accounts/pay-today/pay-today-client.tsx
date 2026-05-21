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
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  SECTION_COLORS,
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
  /** Mig 048 — true if this payment has already been included in
   *  a previous HDFC CSV download. Used to render a 🔒 badge on
   *  the row and to exclude from the "downloadable now" count. */
  hdfcCsvDownloaded: boolean;
};

/** Legacy app-level default — only used as a fallback when a vendor
 *  hasn't set its own payment_terms_days. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 45;

/** Mig 052 — bank_rejected payments live in their own holding
 *  section between Confirmed and Paid Today. The row carries
 *  enough context for the accountant to decide the next step
 *  (try again, mark paid manually, send back to due) without
 *  drilling into the bill. */
export type BankRejectedRow = {
  id: string;
  billId: string;
  vendorName: string;
  billToken: string;
  vendorBillNo: string;
  billOutstanding: number;
  proposedAmount: number;
  batchId: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string;
};

type ServerResult = { ok: true } | { ok: false; error: string };

export function PayTodayClient({
  proposedRows,
  confirmedRows,
  bankRejectedRows,
  canConfirm,
  canMarkPaid,
  canCancel,
  confirmAction,
  markPaidAction,
  cancelAction,
  bankRejectAction,
  retryBankRejectedAction,
}: {
  proposedRows: PayTodayRow[];
  confirmedRows: PayTodayRow[];
  bankRejectedRows: BankRejectedRow[];
  canConfirm: boolean;
  canMarkPaid: boolean;
  canCancel: boolean;
  confirmAction: (formData: FormData) => Promise<ServerResult>;
  markPaidAction: (formData: FormData) => Promise<ServerResult>;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
  bankRejectAction: (formData: FormData) => Promise<ServerResult>;
  retryBankRejectedAction: (formData: FormData) => Promise<ServerResult>;
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

  // Daksh follow-on (May 2026): group confirmed rows by their
  // proposal_batch_id so each batch can be downloaded as its OWN
  // HDFC file. Stops a "13 in confirmed = one 13-row CSV" problem
  // when two propose-pay-today batches stack up — each batch
  // becomes its own upload to HDFC instead.
  const confirmedBatches = useMemo(() => {
    const map = new Map<string, PayTodayRow[]>();
    for (const r of confirmedRows) {
      const key = r.batchId ?? "unbatched";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    // Sort batches by the earliest proposedAt within each (oldest
    // first — keeps the queue feeling like a queue).
    return [...map.entries()]
      .map(([batchId, rows]) => ({
        batchId,
        rows,
        proposedAt: rows.reduce<string | null>((earliest, r) => {
          if (!r.proposedAt) return earliest;
          if (!earliest) return r.proposedAt;
          return r.proposedAt < earliest ? r.proposedAt : earliest;
        }, null),
      }))
      .sort((a, b) => {
        if (!a.proposedAt && !b.proposedAt) return 0;
        if (!a.proposedAt) return 1;
        if (!b.proposedAt) return -1;
        return a.proposedAt.localeCompare(b.proposedAt);
      });
  }, [confirmedRows]);

  // (Paid Today section is rendered in the server page —
  // batch-grouping for paid lives there, not here.)

  const [activeMarkRow, setActiveMarkRow] = useState<PayTodayRow | null>(null);
  // Mig 052 — opens the "Reason for bank decline" slide-over for a
  // confirmed row. Separate from activeMarkRow because the two flows
  // can never overlap (a row is either Mark Paid or Bank Decline,
  // never both at once).
  const [activeBankRejectRow, setActiveBankRejectRow] =
    useState<PayTodayRow | null>(null);
  // Mig 052 — adapter for the "Mark paid manually" affordance on a
  // bank-rejected row. The Mark Paid slide-over expects a
  // PayTodayRow, so we synthesise a minimal one (status='confirmed'
  // for the slide-over's UX; server action accepts bank_rejected
  // too, see actions.ts).
  function synthesisePayRowFromRejected(r: BankRejectedRow): PayTodayRow {
    return {
      id: r.id,
      billId: r.billId,
      status: "confirmed",
      proposedAmount: r.proposedAmount,
      proposedByName: null,
      proposedAt: null,
      confirmedByName: null,
      confirmedAt: null,
      batchId: r.batchId,
      vendorName: r.vendorName,
      billToken: r.billToken,
      vendorBillNo: r.vendorBillNo,
      billDate: null,
      billOutstanding: r.billOutstanding,
      billTotal: 0,
      daysSinceBill: null,
      prematureForPayment: false,
      paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS,
      hdfcCsvDownloaded: false,
    };
  }

  // Daksh's 45-day rule — count premature rows across both sections so
  // the warning banner is visible regardless of which step the payment
  // is at (proposed or confirmed).
  const prematureRows = [...proposedRows, ...confirmedRows].filter(
    (r) => r.prematureForPayment,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {prematureRows.length > 0 && (
        // Mig 042 follow-on (Daksh): the verbose warning didn't
        // portray its purpose — too much to read. Now: one short
        // sentence, then the affected bills as small chips below.
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(251, 191, 36, 0.10)",
            border: "1.5px solid #f59e0b",
            borderLeft: "5px solid #b45309",
            borderRadius: 10,
            fontSize: 13,
            color: "#78350f",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">⚠️</span>
          <strong style={{ fontSize: 13 }}>
            Paying early —{" "}
            {prematureRows.length} bill{prematureRows.length === 1 ? "" : "s"}{" "}
            below vendor terms. Double-check before release.
          </strong>
          <div
            style={{
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              flex: "1 1 auto",
              minWidth: 0,
              justifyContent: "flex-end",
            }}
          >
            {prematureRows.slice(0, 8).map((r) => (
              <span
                key={r.id}
                title={`${r.vendorName} · ${r.daysSinceBill} days since bill · terms ${r.paymentTermsDays}d`}
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "rgba(180, 83, 9, 0.12)",
                  color: "#78350f",
                  borderRadius: 999,
                  fontFamily: "ui-monospace, monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {r.vendorName} {r.daysSinceBill}d/{r.paymentTermsDays}d
              </span>
            ))}
            {prematureRows.length > 8 && (
              <span
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  color: "#78350f",
                  fontWeight: 700,
                }}
              >
                +{prematureRows.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Proposed section */}
      <SectionBlock
        sectionId="section-proposed"
        title="Proposed"
        emoji="📥"
        emptyMessage={
          canConfirm
            ? "No proposals waiting for confirmation."
            : "Accountant hasn't proposed any payments yet. Open Due Bills to propose."
        }
        count={proposedRows.length}
        total={proposedRows.reduce((s, r) => s + r.proposedAmount, 0)}
        tint={SECTION_COLORS.proposed}
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
        sectionId="section-confirmed"
        title="Confirmed — ready to pay"
        emoji="✅"
        emptyMessage="Nothing confirmed yet. Confirmed proposals from the owner land here."
        count={confirmedRows.length}
        total={confirmedRows.reduce((s, r) => s + r.proposedAmount, 0)}
        tint={SECTION_COLORS.confirmed}
      >
        {/* Mig 048 + Daksh follow-on (May 2026): confirmed rows
            grouped by their propose_pay_today batch. Each batch gets
            its OWN Preview Excel + Download CSV buttons so 8
            confirmed today + 5 confirmed tomorrow stay two separate
            HDFC uploads, not one merged 13-row file.
            ConfirmedBatch component renders the batch header + the
            per-batch download controls + the rows. */}
        {confirmedBatches.map((batch, idx) => (
          <ConfirmedBatch
            key={batch.batchId}
            batchId={batch.batchId}
            batchIndex={idx + 1}
            rows={batch.rows}
            canMarkPaid={canMarkPaid}
            canCancel={canCancel}
            cancelAction={cancelAction}
            onMarkPaid={(row) => setActiveMarkRow(row)}
            // Mig 052 — bank-decline trigger on confirmed rows.
            onBankReject={
              canMarkPaid
                ? (row) => setActiveBankRejectRow(row)
                : undefined
            }
          />
        ))}
      </SectionBlock>

      {/* Mig 052 — Bank Rejected section. Sits between Confirmed and
          Paid Today so it's visible mid-flow: the rejected rows are
          "in flight pending next action" and the accountant needs
          to clear them before end-of-day. Section only renders when
          there's at least one rejected row, to keep the page tidy
          on clean days. */}
      {bankRejectedRows.length > 0 && (
        <SectionBlock
          sectionId="section-bank-rejected"
          title="Bank rejected — awaiting next action"
          emoji="🏦"
          emptyMessage="" /* never shown, since we gate on length > 0 */
          count={bankRejectedRows.length}
          total={bankRejectedRows.reduce((s, r) => s + r.proposedAmount, 0)}
          tint="#b91c1c"
        >
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(185, 28, 28, 0.06)",
              border: "1px solid rgba(185, 28, 28, 0.25)",
              borderRadius: 10,
              marginBottom: 10,
              fontSize: 12,
              color: "#7f1d1d",
              lineHeight: 1.5,
            }}
          >
            HDFC refused these rows. Pick what to do for each: <strong>🔁 Try
            again</strong> drops it back into the proposed pool so it can join
            tomorrow's batch, <strong>💸 Mark paid manually</strong> closes it
            (cash / RTGS done outside HDFC bulk), or <strong>↩ Send to due</strong>
            cancels and returns it to the outstanding-bills list.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bankRejectedRows.map((r) => (
              <BankRejectedRowCard
                key={r.id}
                row={r}
                canMarkPaid={canMarkPaid}
                canCancel={canCancel}
                cancelAction={cancelAction}
                retryAction={retryBankRejectedAction}
                onMarkPaidManually={() =>
                  setActiveMarkRow(synthesisePayRowFromRejected(r))
                }
              />
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Mig 052 — Bank decline reason slide-over */}
      <SidePanel
        open={activeBankRejectRow !== null}
        onClose={() => setActiveBankRejectRow(null)}
        title={
          activeBankRejectRow ? (
            <span>
              Bank declined ·{" "}
              <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "#b91c1c" }}>
                {activeBankRejectRow.billToken}
              </code>
            </span>
          ) : (
            "Bank declined"
          )
        }
        description={
          activeBankRejectRow
            ? `${activeBankRejectRow.vendorName} · ₹${activeBankRejectRow.proposedAmount.toLocaleString("en-IN")}`
            : undefined
        }
      >
        {activeBankRejectRow && (
          <BankRejectForm
            row={activeBankRejectRow}
            bankRejectAction={bankRejectAction}
            onSuccess={() => setActiveBankRejectRow(null)}
          />
        )}
      </SidePanel>

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

/** Mig 042 follow-on — Pay Today sections now wear a strongly
 *  colour-banded sticky banner. As the user scrolls through a long
 *  list of proposed or confirmed payments, the banner stays pinned
 *  to the top of the viewport so the section identity is always
 *  visible. Each section gets its own tint (amber / green / blue)
 *  for unmistakable fast-scroll orientation. */
function SectionBlock({
  sectionId,
  title,
  emoji,
  emptyMessage,
  count,
  total,
  tint,
  children,
}: {
  sectionId: string;
  title: string;
  emoji: string;
  emptyMessage: string;
  count: number;
  total: number;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div id={sectionId} style={{ marginBottom: 18 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          marginBottom: 12,
          background: `linear-gradient(135deg, ${tint}EE 0%, ${tint}DD 100%)`,
          color: "#fff",
          borderRadius: 10,
          boxShadow: `0 2px 8px ${tint}44`,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
          {emoji}
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </h2>
        <span
          style={{
            padding: "2px 10px",
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "ui-monospace, monospace",
            background: "rgba(255,255,255,0.22)",
            borderRadius: 999,
          }}
        >
          {count} payment{count === 1 ? "" : "s"}
        </span>
        {count > 0 && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 800,
              opacity: 0.92,
              fontFamily: "ui-monospace, monospace",
              letterSpacing: "0.02em",
            }}
          >
            ₹{total.toLocaleString("en-IN")}
          </span>
        )}
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
        // The section tint cascades down so child cards can pick it
        // up via CSS variable. ProposedBatch + ConfirmedRow read it
        // off and render a matching left-border accent.
        <div
          style={{ ["--section-tint" as string]: tint } as React.CSSProperties}
        >
          {children}
        </div>
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

  const isLegacyBatch = batchId === "unbatched";

  function runConfirm() {
    setError(null);
    if (isLegacyBatch) {
      // Mig follow-on (Daksh, May 2026): legacy proposals (rows
      // from before mig 044 when batches got their own id) can't
      // be "confirmed" — the server action keys off batch_id and
      // there isn't one. But the user still needs a way to clear
      // them. Loop through each row and withdraw it individually.
      // Same per-row cancelAction the Withdraw button uses elsewhere.
      startTransition(async () => {
        for (const r of rows) {
          const fd = new FormData();
          fd.set("payment_id", r.id);
          fd.set("cancel_reason", "accountant_withdrew_legacy_batch");
          const result = await cancelAction(fd);
          if (!result.ok) {
            setError(`Could not withdraw ${r.vendorName} · ${r.billToken}: ${result.error}`);
            return;
          }
        }
        router.refresh();
      });
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
    <>
      {/* Mig 053 follow-on — branded overlay while the batch
          confirm runs. Owner sees the spinning MTCPL logo so they
          know the click registered + the action is committing. */}
      <FinanceLoadingOverlay show={pending} label="Confirming batch…" />
    <div
      style={{
        marginBottom: 14,
        background: "#fff",
        // Mig 042 follow-on — section tint flows down via CSS var
        // set on the SectionBlock wrapper. Fast-scroll glance sees a
        // matching coloured left edge on every card in this section.
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `5px solid var(--section-tint, ${ACCOUNTS_TOKENS.accent})`,
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
            {new Date(rows[0].proposedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
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
            background: isLegacyBatch ? "#fef3c7" : ACCOUNTS_TOKENS.surfaceMuted,
            borderTop: `1px solid ${isLegacyBatch ? "#d97706" : ACCOUNTS_TOKENS.border}`,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {isLegacyBatch ? (
            <>
              <span style={{ fontSize: 12, color: "#92400e", fontWeight: 600, marginRight: "auto" }}>
                ⚠ Legacy data — no batch_id. Confirming isn't possible;
                withdraw to clear, then re-propose from Due Bills.
              </span>
              <button
                type="button"
                onClick={runConfirm}
                disabled={pending}
                style={{
                  ...BUTTON_STYLES.primary,
                  background: "#b45309",
                  borderColor: "#92400e",
                }}
              >
                {pending
                  ? "Withdrawing…"
                  : `Withdraw all ${rows.length} bill${rows.length === 1 ? "" : "s"}`}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
    </>
  );
}

/** Confirmed-section batch card. Mirrors ProposedBatch but for the
 *  Confirmed-Ready-to-Pay stage.
 *
 *  Each card =
 *    • Batch header (number, total ₹, payment count, proposed-at)
 *    • Per-batch buttons: Preview Excel + Download CSV (locks per
 *      batch — different batches stay independent).
 *    • A column of ConfirmedRow components (existing UI).
 *
 *  Lock semantics:
 *    All rows in this batch already downloaded → grey "🔒 In HDFC
 *      file" badge, Download CSV button disabled.
 *    Partial → some rows in the batch are locked, others aren't.
 *      Download button covers the un-locked subset. (Rare in
 *      practice — usually a batch is fully downloaded as one file.)
 *    None downloaded → Download CSV active, will lock the whole
 *      batch on click. */
type MissingFieldReason = {
  paymentId: string;
  billToken: string;
  vendorId: string;
  vendorName: string;
  missing: string[];
};

function ConfirmedBatch({
  batchId,
  batchIndex,
  rows,
  canMarkPaid,
  canCancel,
  cancelAction,
  onMarkPaid,
  onBankReject,
}: {
  batchId: string;
  batchIndex: number;
  rows: PayTodayRow[];
  canMarkPaid: boolean;
  canCancel: boolean;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
  onMarkPaid: (row: PayTodayRow) => void;
  /** Mig 052 — when set, ConfirmedRow renders a "❌ Bank declined"
   *  button alongside Mark Paid / Send to due. Undefined for users
   *  who don't have canMarkPaid permission. */
  onBankReject?: (row: PayTodayRow) => void;
}) {
  const total = rows.reduce((s, r) => s + r.proposedAmount, 0);
  const downloadableCount = rows.filter((r) => !r.hdfcCsvDownloaded).length;
  const lockedCount = rows.filter((r) => r.hdfcCsvDownloaded).length;
  const allLocked = downloadableCount === 0 && rows.length > 0;
  const someLocked = lockedCount > 0;

  // Mig 048 follow-on (Daksh): pre-flight the export so a missing-
  // field error renders as a tidy panel in-page, not raw JSON in a
  // new tab. Click → fetch ?check_only=1 → if missing[], show the
  // panel below the buttons; if ok, fire the actual download URL.
  const [missing, setMissing] = useState<MissingFieldReason[] | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [checking, setChecking] = useState<"" | "xlsx" | "csv">("");

  // Earliest proposedAt in the batch (used in the header label).
  const earliestProposedAt = rows.reduce<string | null>((acc, r) => {
    if (!r.proposedAt) return acc;
    if (!acc) return r.proposedAt;
    return r.proposedAt < acc ? r.proposedAt : acc;
  }, null);

  const isUnbatched = batchId === "unbatched";
  const previewHref = isUnbatched
    ? "/api/accounts/hdfc-export?format=xlsx"
    : `/api/accounts/hdfc-export?format=xlsx&batch_id=${encodeURIComponent(batchId)}`;
  const csvHref =
    downloadableCount > 0
      ? isUnbatched
        ? "/api/accounts/hdfc-export?format=csv"
        : `/api/accounts/hdfc-export?format=csv&batch_id=${encodeURIComponent(batchId)}`
      : "#";

  return (
    <div
      style={{
        marginBottom: 14,
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `5px solid var(--section-tint, ${ACCOUNTS_TOKENS.success})`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        overflow: "hidden",
      }}
    >
      {/* Batch header */}
      <div
        style={{
          padding: "12px 16px",
          background: ACCOUNTS_TOKENS.successLight,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: ACCOUNTS_TOKENS.success,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span>📦 Batch {batchIndex}</span>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>
              {rows.length} payment{rows.length === 1 ? "" : "s"}
            </span>
            <span style={{ color: "var(--muted)" }}>·</span>
            <span style={{ color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
              ₹{total.toLocaleString("en-IN")}
            </span>
            {earliestProposedAt && (
              <>
                <span style={{ color: "var(--muted)" }}>·</span>
                <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                  Proposed{" "}
                  {new Date(earliestProposedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            )}
            {allLocked && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 10,
                  background: "rgba(168,85,247,0.16)",
                  color: "#7c3aed",
                  border: "1px solid rgba(168,85,247,0.35)",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
                title="Whole batch already included in a downloaded HDFC CSV"
              >
                🔒 IN HDFC FILE
              </span>
            )}
            {someLocked && !allLocked && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 10,
                  background: "rgba(168,85,247,0.10)",
                  color: "#7c3aed",
                  border: "1px solid rgba(168,85,247,0.25)",
                  fontWeight: 700,
                }}
              >
                {lockedCount}/{rows.length} LOCKED
              </span>
            )}
          </div>
          {isUnbatched && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: ACCOUNTS_TOKENS.warning,
                fontStyle: "italic",
              }}
            >
              Legacy data — these confirmed payments lack a batch ID.
              Download will include ALL such payments.
            </p>
          )}
        </div>

        {/* Per-batch action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={checking !== ""}
            onClick={async () => {
              setMissing(null);
              setOtherError(null);
              setChecking("xlsx");
              try {
                const checkUrl = `${previewHref}&check_only=1`;
                const r = await fetch(checkUrl, { credentials: "same-origin" });
                if (r.ok) {
                  window.location.href = previewHref;
                  return;
                }
                const body = await r.json().catch(() => null);
                if (body && Array.isArray(body.missing) && body.missing.length > 0) {
                  setMissing(body.missing as MissingFieldReason[]);
                } else {
                  setOtherError(body?.error ?? `Preflight failed (HTTP ${r.status}).`);
                }
              } catch (e) {
                setOtherError(e instanceof Error ? e.message : "Network error");
              } finally {
                setChecking("");
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              background: "#fff",
              color: "var(--gold-dark)",
              border: "1.5px solid var(--gold-dark)",
              borderRadius: 8,
              whiteSpace: "nowrap",
              cursor: checking ? "wait" : "pointer",
              opacity: checking === "xlsx" ? 0.6 : 1,
            }}
            title="Preview this batch as an .xlsx with header row. Doesn't lock anything."
          >
            {checking === "xlsx" ? "Checking…" : "👁 Preview (Excel)"}
          </button>
          <button
            type="button"
            disabled={checking !== "" || downloadableCount === 0}
            onClick={async () => {
              if (downloadableCount === 0) return;
              setMissing(null);
              setOtherError(null);
              setChecking("csv");
              try {
                const checkUrl = `${previewHref.replace("format=xlsx", "format=csv")}&check_only=1`;
                const r = await fetch(checkUrl, { credentials: "same-origin" });
                if (r.ok) {
                  // Pre-flight clean → confirm before firing the
                  // real download (which locks the rows).
                  const finalUrl = previewHref.replace("format=xlsx", "format=csv");
                  const totalToPay = rows
                    .filter((row) => !row.hdfcCsvDownloaded)
                    .reduce((s, row) => s + row.proposedAmount, 0);
                  const ok = window.confirm(
                    `Download Batch ${batchIndex} (${downloadableCount} payment${
                      downloadableCount === 1 ? "" : "s"
                    }, ₹${totalToPay.toLocaleString(
                      "en-IN",
                    )}) as HDFC CSV?\n\nThese rows will be LOCKED. To re-issue you'll need a developer.\n\nProceed only if you're about to upload this file to HDFC.`,
                  );
                  if (ok) window.location.href = finalUrl;
                  return;
                }
                const body = await r.json().catch(() => null);
                if (body && Array.isArray(body.missing) && body.missing.length > 0) {
                  setMissing(body.missing as MissingFieldReason[]);
                } else {
                  setOtherError(body?.error ?? `Preflight failed (HTTP ${r.status}).`);
                }
              } catch (e) {
                setOtherError(e instanceof Error ? e.message : "Network error");
              } finally {
                setChecking("");
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              background: downloadableCount > 0 ? "var(--gold)" : "var(--border)",
              color: downloadableCount > 0 ? "#fff" : "var(--muted)",
              border:
                downloadableCount > 0
                  ? "1.5px solid var(--gold-dark)"
                  : "1.5px solid var(--border)",
              borderRadius: 8,
              whiteSpace: "nowrap",
              opacity: downloadableCount > 0 ? (checking === "csv" ? 0.6 : 1) : 0.55,
              cursor:
                checking !== ""
                  ? "wait"
                  : downloadableCount > 0
                    ? "pointer"
                    : "not-allowed",
            }}
            title={
              downloadableCount > 0
                ? `Generate Batch ${batchIndex}'s HDFC CSV. Locks these ${downloadableCount} row(s).`
                : "This batch is already in a downloaded HDFC CSV."
            }
          >
            {checking === "csv" ? "Checking…" : `📥 Download CSV (${downloadableCount})`}
          </button>
        </div>
      </div>

      {/* Mig 048 follow-on — missing-fields panel. Shown when a
          preflight came back with missing[]. Each row links to the
          vendor's edit page so the accountant can fix in one click. */}
      {missing && missing.length > 0 && (
        <div
          role="alert"
          style={{
            margin: "0 12px 12px",
            padding: "12px 14px",
            background: "rgba(220, 38, 38, 0.06)",
            border: "1px solid rgba(220, 38, 38, 0.35)",
            borderLeft: "4px solid #b91c1c",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#7f1d1d" }}>
            ⚠ {missing.length} vendor{missing.length === 1 ? "" : "s"} need fixing before this batch can be downloaded
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {missing.map((m) => (
              <li
                key={m.paymentId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  flexWrap: "wrap",
                }}
              >
                <code
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    padding: "1px 6px",
                    background: "var(--surface-alt, #f3f4f6)",
                    borderRadius: 4,
                    color: "var(--muted)",
                  }}
                >
                  {m.billToken}
                </code>
                <Link
                  href={`/accounts/vendors/${m.vendorId}`}
                  style={{
                    color: "#1d4ed8",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.vendorName} →
                </Link>
                <span style={{ color: "var(--muted)" }}>missing:</span>
                {m.missing.map((field) => (
                  <span
                    key={field}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 4,
                      background: "rgba(220, 38, 38, 0.12)",
                      color: "#7f1d1d",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {field}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "var(--muted)",
              fontStyle: "italic",
            }}
          >
            Click each vendor name → fill the missing fields → save → come back and retry the download.
          </p>
        </div>
      )}

      {otherError && !missing && (
        <div
          role="alert"
          style={{
            margin: "0 12px 12px",
            padding: "10px 12px",
            background: "rgba(220, 38, 38, 0.06)",
            border: "1px solid rgba(220, 38, 38, 0.35)",
            borderRadius: 8,
            fontSize: 12,
            color: "#7f1d1d",
          }}
        >
          {otherError}
        </div>
      )}

      {/* Individual rows */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <ConfirmedRow
            key={row.id}
            row={row}
            canMarkPaid={canMarkPaid}
            canCancel={canCancel}
            cancelAction={cancelAction}
            onMarkPaid={() => onMarkPaid(row)}
            onBankReject={onBankReject ? () => onBankReject(row) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function ConfirmedRow({
  row,
  canMarkPaid,
  canCancel,
  cancelAction,
  onMarkPaid,
  onBankReject,
}: {
  row: PayTodayRow;
  canMarkPaid: boolean;
  canCancel: boolean;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
  onMarkPaid: () => void;
  /** Mig 052 — accountant clicked "❌ Bank declined" on this row.
   *  Opens the reason slide-over. Undefined hides the button. */
  onBankReject?: () => void;
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
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `5px solid var(--section-tint, ${ACCOUNTS_TOKENS.success})`,
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
            {/* Mig 048 — HDFC CSV download lock indicator. When this
                row was already included in a downloaded HDFC CSV, it
                shows up here so the accountant knows it's "in flight"
                at the bank and shouldn't be re-issued. */}
            {row.hdfcCsvDownloaded && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(168,85,247,0.12)",
                  color: "#7c3aed",
                  border: "1px solid rgba(168,85,247,0.35)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
                title="This payment is in a downloaded HDFC CSV. It won't appear in the next CSV download. After HDFC processes it, mark it paid here."
              >
                🔒 In HDFC file
              </span>
            )}
          </div>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--muted)" }}>
            Bill <code style={{ fontFamily: "ui-monospace, monospace" }}>{row.vendorBillNo}</code>
            {" · Outstanding "}
            <Money value={row.billOutstanding} size="small" tone="muted" />
          </p>
          {row.confirmedAt && (
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
              Confirmed{" "}
              {new Date(row.confirmedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
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
        {/* Mig 052 — only visible to canMarkPaid users (accountant /
            owner / dev). Click → opens reason slide-over → on submit,
            row moves to the Bank Rejected section. */}
        {onBankReject && (
          <button
            type="button"
            onClick={onBankReject}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: "#b91c1c",
              border: "1px solid rgba(185, 28, 28, 0.45)",
              borderRadius: 8,
              cursor: "pointer",
            }}
            title="The bank refused this row (wrong IFSC, account closed, NSF, etc.). Moves it to the holding section instead of cancelling outright."
          >
            ❌ Bank declined
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={runCancel}
            disabled={pending}
            style={BUTTON_STYLES.ghost}
            title="Cancel this payment and return the bill to the due-bills list"
          >
            ↩ Send back to due
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

  // Migration 042 follow-on (Daksh):
  // "why iam able to change amount paid in final stage it can open
  // gate for shady work for emplyees."
  //
  // paid_amount is no longer editable at the Mark Paid stage. It's
  // locked to the proposed_amount the owner confirmed. If the
  // accountant needs to pay a different amount, the only path is:
  //   1. Owner cancels the confirmed payment ("Send back to due")
  //   2. Accountant proposes the new (lower) amount
  //   3. Owner re-confirms
  //   4. Accountant marks paid
  // Server action (markPaymentPaidAction) also ignores the field
  // from the form and reads proposed_amount from the row directly,
  // so a hand-crafted POST can't bypass this.
  const paidAmount = String(row.proposedAmount);
  const [method, setMethod] = useState<string>("neft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const paidNum = row.proposedAmount;

  // Mig 042 — UTR / reference is mandatory for every non-cash
  // payment method. Cash is the only method that legitimately has
  // no reference. Without it the voucher won't print correctly + we
  // lose audit trail to the bank statement.
  const referenceMandatory = method !== "cash";
  const referenceMissing = referenceMandatory && !reference.trim();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (referenceMissing) {
      return setError(
        `${method.toUpperCase()} payments need a reference (UTR / cheque no / UPI txn id). Switch to "Cash" if no reference exists.`,
      );
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      // paid_amount is sent for the audit log, but the server action
      // re-reads proposed_amount from the DB row and uses THAT as
      // the source of truth — see markPaymentPaidAction.
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
      // Mig 053 follow-on (Daksh): the FinanceLoadingOverlay was
      // disappearing the moment the await above resolved — but
      // router.refresh() kicks off an async RSC re-render that the
      // useTransition pending state doesn't track perfectly, and the
      // top-bar NavigationProgress kept spinning AFTER our branded
      // overlay had already vanished. Holding here for 700ms before
      // calling onSuccess keeps the form (and its overlay) mounted
      // long enough to cover the refresh, so the user sees ONE
      // continuous loading state from click to settled UI.
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      onSuccess();
    });
  }

  return (
    <>
      {/* Mig 053 follow-on — HDFC-style spinning logo overlay while
          Mark Paid runs. This is the slowest finance action (PDF +
          email + audit), so it benefits most from a clear loading
          state. */}
      <FinanceLoadingOverlay show={pending} label="Marking paid · sending voucher…" />
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

      {/* Mig 042 follow-on — paid_amount is LOCKED to the confirmed
          proposal. No editing at this stage; the only legal flow to
          change the amount is owner clicks "Send back to due", the
          accountant proposes a new amount, owner re-confirms. */}
      <Field label="Amount to pay (locked to confirmed amount)" required>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1.5px solid ${ACCOUNTS_TOKENS.borderStrong ?? ACCOUNTS_TOKENS.border}`,
            borderRadius: 10,
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>🔒</span>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            ₹{paidNum.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          To pay a different amount, ask the owner to <strong>send the
          proposal back to due</strong>. Re-propose with the corrected
          amount and have it re-confirmed.
        </span>
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

      <Field
        label={
          referenceMandatory
            ? `Reference (UTR / cheque no / UPI txn) — required for ${method.toUpperCase()}`
            : "Reference (cheque no / UTR / UPI txn)"
        }
        required={referenceMandatory}
      >
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={
            method === "neft" || method === "rtgs" || method === "imps"
              ? "e.g. UTR1234567890"
              : method === "cheque"
                ? "e.g. 000123"
                : method === "upi"
                  ? "e.g. 2026051411234567"
                  : method === "cash"
                    ? "optional — receipt no, if any"
                    : "e.g. UTR / txn id"
          }
          required={referenceMandatory}
          aria-invalid={referenceMissing ? true : undefined}
          style={{
            ...INPUT_STYLE,
            fontFamily: "ui-monospace, monospace",
            borderColor: referenceMissing
              ? ACCOUNTS_TOKENS.danger
              : (INPUT_STYLE as React.CSSProperties).borderColor,
          }}
        />
        {referenceMissing && (
          <span
            style={{
              fontSize: 11,
              color: ACCOUNTS_TOKENS.danger,
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            UTR / reference is required for {method.toUpperCase()}. The voucher
            won't print without it.
          </span>
        )}
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
        <button type="submit" disabled={pending} style={BUTTON_STYLES.primary}>
          {pending ? "Saving…" : "✓ Record payment"}
        </button>
      </div>
    </form>
    </>
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

// ══════════════════════════════════════════════════════════════════
// Mig 052 — Bank-rejected lifecycle UI
// ══════════════════════════════════════════════════════════════════

/** Slide-over content for "❌ Bank declined" on a confirmed row.
 *  Captures the required rejection reason and flips the payment to
 *  status='bank_rejected' via bankRejectAction. Reason is mandatory
 *  at both the client and server (≥3 chars) — the audit log keeps
 *  it forever so there's always a "why" for every rejection. */
function BankRejectForm({
  row,
  bankRejectAction,
  onSuccess,
}: {
  row: PayTodayRow;
  bankRejectAction: (formData: FormData) => Promise<ServerResult>;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const REASON_QUICK_PICKS = [
    "Wrong IFSC",
    "Account closed",
    "Beneficiary name mismatch",
    "Insufficient funds",
    "Account does not exist",
  ];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return setError("Tell us why HDFC refused this payment (min 3 chars).");
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      fd.set("rejection_reason", trimmed);
      const r = await bankRejectAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      // Mig 053 follow-on — same overlay-stays-mounted pattern as
      // MarkPaidForm. Keeps the spinning logo visible until the
      // refreshed UI is on screen.
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      onSuccess();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div
        style={{
          padding: "12px 14px",
          background: "rgba(185, 28, 28, 0.06)",
          border: "1px solid rgba(185, 28, 28, 0.25)",
          borderRadius: 10,
          fontSize: 12,
          color: "#7f1d1d",
          lineHeight: 1.5,
        }}
      >
        Marking this row as <strong>bank declined</strong> moves it out of
        Confirmed and into the holding section below. The bill stays open —
        you can retry, mark paid manually, or send back to due from there.
      </div>

      <Field label="Reason" required>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Wrong IFSC, Account closed, Insufficient funds"
          rows={3}
          required
          minLength={3}
          maxLength={500}
          style={{
            ...INPUT_STYLE,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </Field>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {REASON_QUICK_PICKS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setReason(q)}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              background: reason === q ? "#b91c1c" : "transparent",
              color: reason === q ? "#fff" : "#7f1d1d",
              border: "1px solid rgba(185, 28, 28, 0.35)",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            color: ACCOUNTS_TOKENS.danger,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={pending || reason.trim().length < 3}
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "#b91c1c",
            color: "#fff",
            border: "1px solid #991b1b",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
            opacity: reason.trim().length < 3 ? 0.55 : 1,
          }}
        >
          {pending ? "Recording…" : "❌ Mark bank declined"}
        </button>
      </div>
    </form>
  );
}

/** Holding-section row. Sits between Confirmed and Paid Today. Three
 *  exits: Try again (re-propose), Mark paid manually (cash/RTGS done
 *  outside HDFC), or Send to due (final give-up). */
function BankRejectedRowCard({
  row,
  canMarkPaid,
  canCancel,
  cancelAction,
  retryAction,
  onMarkPaidManually,
}: {
  row: BankRejectedRow;
  canMarkPaid: boolean;
  canCancel: boolean;
  cancelAction: (formData: FormData) => Promise<ServerResult>;
  retryAction: (formData: FormData) => Promise<ServerResult>;
  onMarkPaidManually: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runRetry() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      const r = await retryAction(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function runSendToDue() {
    setError(null);
    if (
      !window.confirm(
        `Send ${row.vendorName} · ${row.billToken} (₹${row.proposedAmount.toLocaleString("en-IN")}) back to the due-bills list?\n\nThe rejection record stays in audit history. You'll have to propose this bill again from Due Bills when ready.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      fd.set("cancel_reason", "bank_rejected_then_sent_to_due");
      const r = await cancelAction(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: "5px solid #b91c1c",
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
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(185, 28, 28, 0.12)",
                color: "#b91c1c",
                border: "1px solid rgba(185, 28, 28, 0.35)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              🏦 Bank rejected
            </span>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>
            Bill <code style={{ fontFamily: "ui-monospace, monospace" }}>{row.vendorBillNo}</code>
            {" · Outstanding "}
            <Money value={row.billOutstanding} size="small" tone="muted" />
          </p>
          <div
            style={{
              fontSize: 12,
              padding: "8px 10px",
              background: "rgba(185, 28, 28, 0.05)",
              borderRadius: 8,
              border: "1px dashed rgba(185, 28, 28, 0.25)",
              color: "#7f1d1d",
              lineHeight: 1.5,
            }}
          >
            <strong>Reason:</strong> {row.rejectionReason || "—"}
          </div>
          {row.rejectedAt && (
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
              Declined{" "}
              {new Date(row.rejectedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {row.rejectedByName ? ` · ${row.rejectedByName}` : ""}
            </p>
          )}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Was confirmed
        </div>
        <Money value={row.proposedAmount} size="large" tone="warning" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", justifyContent: "flex-end", marginTop: 6 }}>
        {error && (
          <span style={{ fontSize: 12, color: ACCOUNTS_TOKENS.danger, marginRight: "auto" }}>
            {error}
          </span>
        )}
        {canMarkPaid && (
          <button
            type="button"
            onClick={runRetry}
            disabled={pending}
            style={BUTTON_STYLES.primary}
            title="Create a fresh proposed payment for the same amount. The new row enters the Proposed pool — confirm it alongside whatever else you're batching."
          >
            🔁 Try again
          </button>
        )}
        {canMarkPaid && (
          <button
            type="button"
            onClick={onMarkPaidManually}
            style={BUTTON_STYLES.secondary}
            title="The vendor was paid by another method (cash, separate RTGS, UPI). Close this rejection by recording the actual payment."
          >
            💸 Mark paid manually
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={runSendToDue}
            disabled={pending}
            style={BUTTON_STYLES.ghost}
            title="Final give-up. The bill goes back to the outstanding list; propose again later if needed."
          >
            ↩ Send to due
          </button>
        )}
      </div>
    </div>
  );
}
