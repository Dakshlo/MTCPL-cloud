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

  // Mig 048 — HDFC CSV download-lock counts. Drives the two
  // header buttons (Preview Excel always shows all; Download CSV
  // only the not-yet-downloaded set).
  const hdfcDownloadableCount = useMemo(
    () => confirmedRows.filter((r) => !r.hdfcCsvDownloaded).length,
    [confirmedRows],
  );
  const hdfcLockedCount = useMemo(
    () => confirmedRows.filter((r) => r.hdfcCsvDownloaded).length,
    [confirmedRows],
  );

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
        {confirmedRows.length > 0 && (
          <>
            {/* HDFC bulk-payment file — two-button flow per Daksh
                (mig 048):
                  • Preview Excel — verify, repeat as needed
                  • Final CSV    — single-shot, locks each row
                                   afterwards so the accountant
                                   can't re-issue and double-pay.
                The locked count + downloadable count come from the
                parent page via downloadableCount / lockedCount, set
                from a server-side query of bill_payments where
                hdfc_csv_downloaded_at IS NULL / NOT NULL on the
                currently-confirmed rows. */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                marginBottom: 10,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {hdfcLockedCount > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, monospace",
                    marginRight: 4,
                  }}
                  title={`${hdfcLockedCount} confirmed payment${hdfcLockedCount === 1 ? "" : "s"} already included in a previous CSV download. They stay visible until you mark them paid. To re-issue, ask a developer to unlock.`}
                >
                  🔒 {hdfcLockedCount} already downloaded
                </span>
              )}
              <a
                href="/api/accounts/hdfc-export?format=xlsx"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: "#fff",
                  color: "var(--gold-dark)",
                  border: "1.5px solid var(--gold-dark)",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                }}
                title="HDFC preview file — all currently confirmed payments, including ones already in flight. With header row. Use this to verify columns and amounts before downloading the real CSV. Doesn't lock anything."
              >
                👁 Preview (Excel)
              </a>
              <a
                href={
                  hdfcDownloadableCount > 0
                    ? "/api/accounts/hdfc-export?format=csv"
                    : "#"
                }
                onClick={(e) => {
                  if (hdfcDownloadableCount === 0) {
                    e.preventDefault();
                    return;
                  }
                  // Soft confirm — accountant clicks once, file
                  // downloads, lock fires. No way back without dev
                  // intervention, so the dialog is worth the friction.
                  const ok = window.confirm(
                    `Download ${hdfcDownloadableCount} payment${
                      hdfcDownloadableCount === 1 ? "" : "s"
                    } as HDFC CSV?\n\nThese rows will be LOCKED — they won't appear in any future CSV download. To re-issue you'll need a developer.\n\nProceed only if you're about to upload this file to HDFC.`,
                  );
                  if (!ok) e.preventDefault();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  background:
                    hdfcDownloadableCount > 0 ? "var(--gold)" : "var(--border)",
                  color:
                    hdfcDownloadableCount > 0 ? "#fff" : "var(--muted)",
                  border:
                    hdfcDownloadableCount > 0
                      ? "1.5px solid var(--gold-dark)"
                      : "1.5px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                  opacity: hdfcDownloadableCount > 0 ? 1 : 0.55,
                  cursor: hdfcDownloadableCount > 0 ? "pointer" : "not-allowed",
                }}
                title={
                  hdfcDownloadableCount > 0
                    ? `Generate the final HDFC CSV for ${hdfcDownloadableCount} payment${hdfcDownloadableCount === 1 ? "" : "s"}. Locks each row — no second download possible.`
                    : "All currently confirmed payments are already in a previous CSV download."
                }
                aria-disabled={hdfcDownloadableCount === 0}
              >
                📥 Download CSV ({hdfcDownloadableCount})
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
