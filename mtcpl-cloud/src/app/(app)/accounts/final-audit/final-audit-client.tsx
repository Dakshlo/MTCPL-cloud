"use client";

/**
 * Migration 053 — Final Audit client UI.
 *
 * Two sections:
 *   1. Pending — each card shows the UTR + amount + vendor bank
 *      info to compare against the bank statement. Two buttons:
 *      ✓ Verified or 🚩 Flag a problem (opens reason slide-over).
 *   2. Recently audited — last 14 days. Verified rows show muted,
 *      flagged rows show prominent red with reason + note.
 *
 * No real-time refresh wiring needed here — bill_payments is in the
 * Supabase publication (mig 052 follow-on), and the global
 * RealtimeRefresh component triggers router.refresh() on any change.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  Money,
  SidePanel,
  VendorAvatar,
} from "../_ui/components";

export type FinalAuditRow = {
  id: string;
  billId: string;
  billToken: string;
  vendorBillNo: string;
  vendorName: string;
  /** Mig 082 follow-on (Daksh) — bill_vendor_id so the audit card's
   *  vendor name can link straight to /accounts/vendors/[id]
   *  instead of the bill page. Owner asked for this — when
   *  auditing a payment they want the vendor's full bill history
   *  + open balances at a glance, not just the single bill. */
  vendorId: string | null;
  vendorBankName: string | null;
  vendorBankAccount: string | null;
  vendorIfsc: string | null;
  vendorHdfcBeneName: string | null;
  paidAmount: number;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentNote: string | null;
  paidByName: string | null;
  paidAt: string | null;
  auditStatus: "pending" | "verified" | "flagged";
  auditedAt: string | null;
  auditedByName: string | null;
  flagReason: string | null;
  flagNote: string | null;
  /** Mig 081 follow-on — sum of amount_outstanding across ALL of
   *  this vendor's bills (the one being audited + every other
   *  open bill). Lets the auditor sanity-check a paid amount
   *  against the vendor's total exposure. */
  vendorTotalOutstanding: number;
  /** Mig 085 — when set, this flagged payment has been settled with a
   *  debit (owner approved). Drives the "Settled" group on the
   *  Flagged Payments page; open flags (null) get the "Settle with
   *  debit" button. */
  debitSettledAt?: string | null;
  /** Mig 085 follow-on (Daksh, June 2026) — the live state of this
   *  flagged payment's debit settlement, so the Flagged Payments
   *  list can show the right affordance:
   *    • "pending"  → a debit is awaiting owner approval. Show an
   *      "in approval" chip, NOT the Settle button (prevents a second
   *      accidental request).
   *    • "settled"  → approved; lives in the Settled tab.
   *    • null       → no active debit; show the Settle button.
   *  Derived server-side from bill_debit_settlements. */
  debitState?: "pending" | "settled" | null;
  /** Amount of the active (pending or approved) debit, for the chip. */
  debitAmount?: number | null;
};

type ServerResult = { ok: true } | { ok: false; error: string };
type BulkResult =
  | { ok: true; verified: number; skipped: Array<{ id: string; reason: string }> }
  | { ok: false; error: string };

/** Must match BULK_VERIFY_MAX in accounts/actions.ts — the queue is sent
 *  in chunks this size so one request never carries 1,390 rows. */
const BULK_CHUNK = 300;

export function FinalAuditClient({
  pendingRows,
  pendingTotalCount,
  pendingPage,
  pendingPageCount,
  pendingFrom,
  auditedRows,
  verifyAction,
  bulkVerifyAction,
  flagAction,
}: {
  pendingRows: FinalAuditRow[];
  /** The whole queue, not this page — the tile and the wording below
   *  must never understate the backlog (see PENDING_PAGE_SIZE). */
  pendingTotalCount: number;
  pendingPage: number;
  pendingPageCount: number;
  /** 0-based index of the first row on this page, for "showing X–Y". */
  pendingFrom: number;
  auditedRows: FinalAuditRow[];
  verifyAction: (formData: FormData) => Promise<ServerResult>;
  bulkVerifyAction: (formData: FormData) => Promise<BulkResult>;
  flagAction: (formData: FormData) => Promise<ServerResult>;
}) {
  const router = useRouter();
  const [activeFlagRow, setActiveFlagRow] = useState<FinalAuditRow | null>(null);

  // ── Multi-select (Daksh, Oct 2026) ──────────────────────────────
  // Virendra: "it loads and does one, it will take longer time —
  // instead give multi select, he can verify multiple at once and
  // finally verify." Ticking is free; the single confirm sends them.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Rows this browser has already verified. The page is server-rendered
  // from a 1,390-row query, so waiting for that round trip before the
  // row disappears is exactly the lag being complained about. Hide them
  // immediately and let the refresh catch up in the background.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // A fresh server list means our optimistic hiding has been applied for
  // real — drop it, so a row that legitimately comes back (someone else
  // changed it) is not hidden forever by a stale id.
  const pendingKey = pendingRows.map((r) => r.id).join(",");
  const lastKey = useRef(pendingKey);
  useEffect(() => {
    if (lastKey.current !== pendingKey) {
      lastKey.current = pendingKey;
      setRemoved(new Set());
    }
  }, [pendingKey]);

  const visiblePending = useMemo(
    () => pendingRows.filter((r) => !removed.has(r.id)),
    [pendingRows, removed],
  );
  const selectedRows = useMemo(
    () => visiblePending.filter((r) => selected.has(r.id)),
    [visiblePending, selected],
  );
  const selectedTotal = selectedRows.reduce((s, r) => s + r.paidAmount, 0);

  function toggleRow(id: string) {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setConfirming(false);
  }

  function selectAll() {
    setConfirming(false);
    setSelected(new Set(visiblePending.map((r) => r.id)));
  }

  /** Mark rows gone locally, then reconcile with the server. The refresh
   *  deliberately sits OUTSIDE the transition: holding the overlay up for
   *  a 1,390-row re-render is the delay we are removing. */
  function settleVerified(ids: string[], message: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setToast(message);
    router.refresh();
  }

  async function runBulkVerify() {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;
    setBusy(true);
    setBulkError(null);
    setConfirming(false);

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += BULK_CHUNK) chunks.push(ids.slice(i, i + BULK_CHUNK));

    let verified = 0;
    const skipped: Array<{ id: string; reason: string }> = [];
    const done: string[] = [];
    setProgress({ done: 0, total: ids.length });

    for (const chunk of chunks) {
      const fd = new FormData();
      fd.set("payment_ids", JSON.stringify(chunk));
      let r: BulkResult;
      try {
        r = await bulkVerifyAction(fd);
      } catch {
        r = { ok: false, error: "Lost connection partway through." };
      }
      if (!r.ok) {
        setBulkError(
          `${r.error}${verified > 0 ? ` ${verified} were already verified before this.` : ""}`,
        );
        break;
      }
      verified += r.verified;
      skipped.push(...r.skipped);
      // Only hide what the server actually stamped.
      const skippedIds = new Set(r.skipped.map((x) => x.id));
      done.push(...chunk.filter((id) => !skippedIds.has(id)));
      setProgress({ done: done.length + skippedIds.size, total: ids.length });
    }

    setBusy(false);
    setProgress(null);

    if (done.length > 0 || verified > 0) {
      const parts = [`${verified} verified`];
      if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
      settleVerified(done, parts.join(" · "));
    }
    if (skipped.length > 0 && !bulkError) {
      setBulkError(
        `${skipped.length} row${skipped.length === 1 ? " was" : "s were"} left alone: ` +
          [...new Set(skipped.map((x) => x.reason))].join(", ") +
          ". Nothing was changed for those.",
      );
    }
  }

  // Group audited rows: flagged first (owner attention), then verified.
  const groupedAudited = useMemo(() => {
    const flagged = auditedRows.filter((r) => r.auditStatus === "flagged");
    const verified = auditedRows.filter((r) => r.auditStatus === "verified");
    return { flagged, verified };
  }, [auditedRows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* Pending section */}
      {visiblePending.length > 0 && (
        <SectionBlock
          sectionId="section-pending"
          title="Awaiting verification"
          emoji="⏳"
          count={pendingTotalCount}
          tint="#b45309"
        >
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(180, 83, 9, 0.06)",
              border: "1px solid rgba(180, 83, 9, 0.25)",
              borderRadius: 10,
              marginBottom: 10,
              fontSize: 12,
              color: "#7c2d12",
              lineHeight: 1.5,
            }}
          >
            For each row: open your bank statement, find the UTR /
            cheque no shown on the card, and confirm <strong>same
            account · same amount · actually credited</strong>. Then
            tap <strong>✓ Verified</strong>. If anything looks off,
            tap <strong>🚩 Flag a problem</strong> — the owner sees
            the flag; no reversal happens. To clear several at once,
            tick their boxes and use the bar below.
          </div>

          {/* ── Selection bar ──────────────────────────────────────
              Sticky so it stays reachable after scrolling past a few
              hundred rows. It only ever VERIFIES — flagging stays
              one at a time, because a flag carries a reason. */}
          <div
            style={{
              position: "sticky",
              top: 8,
              zIndex: 5,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              marginBottom: 10,
              background: selected.size > 0 ? "#0f3d23" : "#fff",
              color: selected.size > 0 ? "#fff" : "var(--text)",
              border: `1px solid ${selected.size > 0 ? "#166534" : ACCOUNTS_TOKENS.border}`,
              borderRadius: 10,
              boxShadow: ACCOUNTS_TOKENS.shadow,
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === visiblePending.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < visiblePending.length;
                }}
                onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                style={{ width: 16, height: 16, cursor: "pointer" }}
                aria-label="Select every payment awaiting verification"
              />
              Select all {visiblePending.length} on this page
            </label>

            <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {selected.size > 0
                ? `${selected.size} selected · ₹${Math.round(selectedTotal).toLocaleString("en-IN")}`
                : "Nothing selected"}
            </span>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              {busy ? (
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                  Verifying… {progress ? `${progress.done} of ${progress.total}` : ""}
                </span>
              ) : confirming ? (
                <>
                  <span style={{ fontSize: 12.5, fontWeight: 700, alignSelf: "center" }}>
                    Verify {selected.size} payment{selected.size === 1 ? "" : "s"} ·
                    ₹{Math.round(selectedTotal).toLocaleString("en-IN")}? This cannot be undone.
                  </span>
                  <button
                    type="button"
                    onClick={runBulkVerify}
                    style={{
                      padding: "8px 14px", fontSize: 13, fontWeight: 800,
                      background: "#15803d", color: "#fff",
                      border: "1px solid #166534", borderRadius: 8, cursor: "pointer",
                    }}
                  >
                    Yes, verify {selected.size}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    style={{
                      padding: "8px 14px", fontSize: 13, fontWeight: 700,
                      background: "transparent", color: "inherit",
                      border: "1px solid rgba(255,255,255,0.45)", borderRadius: 8, cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      style={{
                        padding: "8px 14px", fontSize: 13, fontWeight: 700,
                        background: "transparent", color: "inherit",
                        border: "1px solid rgba(255,255,255,0.45)", borderRadius: 8, cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={selected.size === 0}
                    onClick={() => setConfirming(true)}
                    style={{
                      padding: "8px 16px", fontSize: 13, fontWeight: 800,
                      background: selected.size === 0 ? "var(--border)" : "#15803d",
                      color: selected.size === 0 ? "var(--muted)" : "#fff",
                      border: `1px solid ${selected.size === 0 ? "var(--border)" : "#166534"}`,
                      borderRadius: 8,
                      cursor: selected.size === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    ✓ Verify selected
                  </button>
                </>
              )}
            </div>
          </div>

          {toast && (
            <div
              role="status"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 12px", marginBottom: 10,
                background: "rgba(21, 128, 61, 0.10)",
                border: "1px solid rgba(21, 128, 61, 0.35)",
                borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: "#15803d",
              }}
            >
              ✓ {toast}
              <button
                type="button"
                onClick={() => setToast(null)}
                style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 800 }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {bulkError && (
            <div
              role="alert"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 12px", marginBottom: 10,
                background: "rgba(185, 28, 28, 0.08)",
                border: "1px solid rgba(185, 28, 28, 0.35)",
                borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: "#b91c1c",
              }}
            >
              ⚠ {bulkError}
              <button
                type="button"
                onClick={() => setBulkError(null)}
                style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 800 }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visiblePending.map((row) => (
              <PendingCard
                key={row.id}
                row={row}
                verifyAction={verifyAction}
                selected={selected.has(row.id)}
                onToggle={() => toggleRow(row.id)}
                onVerified={() => settleVerified([row.id], "1 verified")}
                onFlag={() => setActiveFlagRow(row)}
              />
            ))}
          </div>

          {/* The queue is served a page at a time. The count above and
              the tile at the top of the page are the WHOLE queue, so a
              backlog can never hide behind the page size. */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              marginTop: 12, padding: "11px 14px", background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`, borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              Showing{" "}
              <strong>
                {(pendingFrom + 1).toLocaleString("en-IN")}–
                {Math.min(pendingFrom + visiblePending.length, pendingTotalCount).toLocaleString("en-IN")}
              </strong>{" "}
              of <strong>{pendingTotalCount.toLocaleString("en-IN")}</strong> waiting
            </span>
            {pendingPageCount > 1 && (
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <PageLink page={pendingPage - 1} disabled={pendingPage <= 1} label="‹ Previous" />
                <em style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: "normal", fontVariantNumeric: "tabular-nums" }}>
                  Page {pendingPage} of {pendingPageCount}
                </em>
                <PageLink page={pendingPage + 1} disabled={pendingPage >= pendingPageCount} label="Next ›" />
              </span>
            )}
          </div>
        </SectionBlock>
      )}

      {/* Flagged section (priority — owner attention) */}
      {groupedAudited.flagged.length > 0 && (
        <SectionBlock
          sectionId="section-flagged"
          title="Flagged — owner attention"
          emoji="🚩"
          count={groupedAudited.flagged.length}
          tint="#b91c1c"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groupedAudited.flagged.map((row) => (
              <FlaggedCard key={row.id} row={row} />
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Verified section (history) */}
      {groupedAudited.verified.length > 0 && (
        <SectionBlock
          sectionId="section-verified"
          title="Recently verified"
          emoji="✓"
          count={groupedAudited.verified.length}
          tint="#15803d"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupedAudited.verified.map((row) => (
              <VerifiedRow key={row.id} row={row} />
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Flag slide-over */}
      <SidePanel
        open={activeFlagRow !== null}
        onClose={() => setActiveFlagRow(null)}
        title={
          activeFlagRow ? (
            <span>
              Flag ·{" "}
              <code
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 14,
                  color: "#b91c1c",
                }}
              >
                {activeFlagRow.billToken}
              </code>
            </span>
          ) : (
            "Flag a problem"
          )
        }
        description={
          activeFlagRow
            ? `${activeFlagRow.vendorName} · ₹${activeFlagRow.paidAmount.toLocaleString("en-IN")} · UTR ${activeFlagRow.paymentReference ?? "—"}`
            : undefined
        }
      >
        {activeFlagRow && (
          <FlagForm
            row={activeFlagRow}
            flagAction={flagAction}
            onSuccess={() => setActiveFlagRow(null)}
          />
        )}
      </SidePanel>
    </div>
  );
}

function SectionBlock({
  sectionId,
  title,
  emoji,
  count,
  tint,
  children,
}: {
  sectionId: string;
  title: string;
  emoji: string;
  count: number;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div id={sectionId} style={{ marginBottom: 4 }}>
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
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Paging is a plain link, so the browser Back button walks the queue
 *  the way the auditor expects and a page can be bookmarked. */
function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  const base: React.CSSProperties = {
    padding: "7px 13px", fontSize: 12.5, fontWeight: 700, borderRadius: 8,
    border: `1px solid ${ACCOUNTS_TOKENS.border}`, textDecoration: "none",
  };
  if (disabled) {
    return <span style={{ ...base, color: "var(--muted)", opacity: 0.5 }}>{label}</span>;
  }
  return (
    <Link href={page <= 1 ? "/accounts/final-audit" : `/accounts/final-audit?page=${page}`}
      style={{ ...base, background: "#fff", color: "var(--text)" }}>
      {label}
    </Link>
  );
}

function PendingCard({
  row,
  verifyAction,
  selected,
  onToggle,
  onVerified,
  onFlag,
}: {
  row: FinalAuditRow;
  verifyAction: (formData: FormData) => Promise<ServerResult>;
  selected: boolean;
  onToggle: () => void;
  /** Parent hides the row and refreshes once — this card no longer
   *  calls router.refresh() itself. That refresh re-runs the page's
   *  full pending query (1,390 rows), so doing it per row is what made
   *  ticking one payment feel slow. */
  onVerified: () => void;
  onFlag: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runVerify() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      const r = await verifyAction(fd);
      if (!r.ok) setError(r.error);
      else onVerified();
    });
  }

  const hasUtr = Boolean(row.paymentReference);
  const isCash = row.paymentMethod === "cash";

  return (
    <>
      {/* Mig 053 follow-on — branded overlay while verify runs. */}
      <FinanceLoadingOverlay show={pending} label="Verifying payment…" />
    <div
      className="final-audit-row"
      style={{
        background: selected ? "rgba(21, 128, 61, 0.05)" : "#fff",
        border: `1px solid ${selected ? "rgba(21, 128, 61, 0.45)" : ACCOUNTS_TOKENS.border}`,
        borderLeft: `5px solid ${selected ? "#15803d" : "#b45309"}`,
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
          {/* Tick to batch this one up; the bar at the top sends them. */}
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={pending}
            style={{ width: 18, height: 18, marginTop: 12, cursor: "pointer", flexShrink: 0 }}
            aria-label={`Select ${row.vendorName} ₹${Math.round(row.paidAmount).toLocaleString("en-IN")} for verification`}
          />
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
              {/* Mig 082 follow-on (Daksh) — vendor name now links
                  to the vendor detail page (full bill history +
                  open balances) instead of just this one bill.
                  Auditor can pivot from "verify this payment" to
                  "what else is open with this vendor" in one tap.
                  The bill token chip on the right still routes to
                  the single-bill view; the bill ID below the
                  vendor name is unchanged. The `from=final-audit`
                  query param tells the vendor page to render a
                  "← Back to Final Audit" button. */}
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
                // Legacy rows with no bill_vendor_id (shouldn't
                // happen — bills always carry one) fall back to a
                // non-linked label so the row still renders.
                <span
                  style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}
                >
                  {row.vendorName}
                </span>
              )}
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
                  background: "rgba(180, 83, 9, 0.12)",
                  color: "#b45309",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Awaiting verify
              </span>
              {/* Mig 081 follow-on (Daksh) — vendor's total
                  outstanding across all their bills. Renders only
                  when > 0 so a brand-new vendor doesn't get a "₹0
                  outstanding" pill. Money used in precise=false
                  (default, integer round-half-up) — the chip is a
                  scan signal, not a paise-level match. */}
              {row.vendorTotalOutstanding > 0 && (
                <span
                  title={`Sum of every open bill for ${row.vendorName}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(37, 99, 235, 0.10)",
                    color: "#1d4ed8",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  Vendor open:{" "}
                  <Money value={row.vendorTotalOutstanding} size="small" />
                </span>
              )}
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
              Bill{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {row.vendorBillNo}
              </code>
            </p>

            {/* The critical compare panel — UTR, method, amount, vendor bank */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 10,
                padding: 10,
                background: "rgba(180, 83, 9, 0.04)",
                border: "1px dashed rgba(180, 83, 9, 0.3)",
                borderRadius: 8,
              }}
            >
              <CompareField
                label="UTR / Reference"
                value={row.paymentReference ?? (isCash ? "(cash — no UTR)" : "—")}
                mono
                emphasis={hasUtr}
                tone={hasUtr || isCash ? "neutral" : "warn"}
              />
              <CompareField
                label="Method"
                value={(row.paymentMethod ?? "—").toUpperCase()}
                mono
              />
              <CompareField
                label="Amount paid"
                value={`₹${row.paidAmount.toLocaleString("en-IN")}`}
                mono
                emphasis
              />
              {row.vendorBankAccount && (
                <CompareField
                  label="Vendor A/C"
                  value={row.vendorBankAccount}
                  mono
                />
              )}
              {row.vendorIfsc && (
                <CompareField label="IFSC" value={row.vendorIfsc} mono />
              )}
              {row.vendorHdfcBeneName && (
                <CompareField
                  label="HDFC bene name"
                  value={row.vendorHdfcBeneName}
                  mono
                />
              )}
            </div>

            {row.paymentNote && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 11,
                  color: "var(--muted)",
                  lineHeight: 1.45,
                }}
              >
                <strong>Note:</strong> {row.paymentNote}
              </p>
            )}
            {row.paidAt && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
                Paid{" "}
                {new Date(row.paidAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {row.paidByName ? ` · by ${row.paidByName}` : ""}
              </p>
            )}
            {error && (
              <p
                role="alert"
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: ACCOUNTS_TOKENS.danger,
                }}
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        className="final-audit-row-actions"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "stretch",
          minWidth: 160,
        }}
      >
        <div
          className="final-audit-row-actions-amount"
          style={{ textAlign: "right" }}
        >
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
          {/* Mig 081 follow-on — `precise` keeps the .paise visible
              so the auditor can match this number exactly against
              the bank statement (where the credit landed to the
              rupee + paise). Money's default rounds; we opt out
              here because rounding would mask a paise-level
              mismatch and defeat the whole point of the audit. */}
          <Money value={row.paidAmount} size="large" tone="success" precise />
        </div>
        <button
          type="button"
          onClick={runVerify}
          disabled={pending}
          style={{
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 700,
            background: "#15803d",
            color: "#fff",
            border: "1px solid #166534",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
          }}
          title="UTR matches the bank statement and the money credited the right vendor"
        >
          {pending ? "Verifying…" : "✓ Verified"}
        </button>
        <button
          type="button"
          onClick={onFlag}
          disabled={pending}
          style={{
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "transparent",
            color: "#b91c1c",
            border: "1px solid rgba(185, 28, 28, 0.45)",
            borderRadius: 8,
            cursor: "pointer",
          }}
          title="Something's off — capture a reason for the owner"
        >
          🚩 Flag a problem
        </button>
      </div>
    </div>
    </>
  );
}

function CompareField({
  label,
  value,
  mono,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
  tone?: "neutral" | "warn";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: emphasis ? 14 : 12,
          fontWeight: emphasis ? 800 : 600,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          color: tone === "warn" ? "#b91c1c" : "var(--text)",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FlaggedCard({ row }: { row: FinalAuditRow }) {
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
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link
          href={`/accounts/bills/${row.billId}`}
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          {row.vendorName}
        </Link>
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
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          🚩 Flagged
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "ui-monospace, monospace",
            fontWeight: 800,
            fontSize: 14,
            color: "var(--text)",
          }}
        >
          ₹{row.paidAmount.toLocaleString("en-IN")}
        </span>
      </div>
      <div
        style={{
          padding: "8px 10px",
          background: "rgba(185, 28, 28, 0.05)",
          border: "1px dashed rgba(185, 28, 28, 0.25)",
          borderRadius: 8,
          fontSize: 12,
          color: "#7f1d1d",
          lineHeight: 1.5,
        }}
      >
        <strong>Reason:</strong> {row.flagReason ?? "—"}
        {row.flagNote && (
          <div style={{ marginTop: 4 }}>
            <strong>Note:</strong> {row.flagNote}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "var(--muted)",
          flexWrap: "wrap",
        }}
      >
        {row.paymentMethod && (
          <span>
            <strong style={{ textTransform: "uppercase" }}>{row.paymentMethod}</strong>
            {row.paymentReference ? ` · ${row.paymentReference}` : ""}
          </span>
        )}
        {row.auditedAt && (
          <span>
            Flagged{" "}
            {new Date(row.auditedAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {row.auditedByName ? ` · by ${row.auditedByName}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function VerifiedRow({ row }: { row: FinalAuditRow }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: "3px solid #15803d",
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          padding: "2px 7px",
          borderRadius: 999,
          background: "rgba(21, 128, 61, 0.12)",
          color: "#15803d",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        ✓ Verified
      </span>
      <Link
        href={`/accounts/bills/${row.billId}`}
        style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", textDecoration: "none" }}
      >
        {row.vendorName}
      </Link>
      <code
        style={{
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          color: "var(--muted)",
        }}
      >
        {row.billToken}
      </code>
      <span
        style={{
          fontSize: 11,
          color: "var(--muted)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        UTR {row.paymentReference ?? "—"}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "ui-monospace, monospace",
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        ₹{row.paidAmount.toLocaleString("en-IN")}
      </span>
      {row.auditedAt && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {new Date(row.auditedAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}

function FlagForm({
  row,
  flagAction,
  onSuccess,
}: {
  row: FinalAuditRow;
  flagAction: (formData: FormData) => Promise<ServerResult>;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const QUICK_REASONS = [
    "UTR not in bank statement",
    "Amount mismatch",
    "Wrong vendor credited",
    "Different beneficiary name",
    "Duplicate / double-paid",
  ];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return setError("Reason required (min 3 chars).");
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("payment_id", row.id);
      fd.set("flag_reason", trimmed);
      fd.set("flag_note", note.trim());
      const r = await flagAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      // Mig 053 follow-on — keep overlay alive through the refresh.
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      onSuccess();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Flagging payment…" />
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
        Flagging this payment <strong>does not</strong> reverse it or change
        the bill's status — the money is already gone. It just surfaces in
        the owner's flagged list for follow-up.
      </div>

      <Field label="Reason" required>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. UTR shown here doesn't appear in the HDFC statement for 14 May"
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
        {QUICK_REASONS.map((q) => (
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

      <Field label="Extra note (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any extra detail for the owner — bank statement page no., account last 4 digits, what to do next, etc."
          rows={3}
          maxLength={1000}
          style={{
            ...INPUT_STYLE,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </Field>

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
          type="button"
          onClick={onSuccess}
          disabled={pending}
          style={BUTTON_STYLES.secondary}
        >
          Cancel
        </button>
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
          {pending ? "Flagging…" : "🚩 Flag this payment"}
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
        {required && (
          <span style={{ color: ACCOUNTS_TOKENS.danger, marginLeft: 4 }}>*</span>
        )}
      </span>
      {children}
    </label>
  );
}
