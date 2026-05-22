"use client";

/**
 * Slab Transfer dispatch UI.
 *
 * Four buckets stacked top-down with strong visual separation so
 * each section reads as its own surface:
 *
 *   1. 🚧 Claimed by me   — BLUE accent. The runner's active work.
 *      Each row: 3D thumb · slab info · From → To route · Mark
 *      delivered (with optional note) · Release claim.
 *
 *   2. 📦 Available       — AMBER accent. Unclaimed pickups.
 *      Each row: 3D thumb · slab info · From → To route · Claim.
 *
 *   3. ✅ Delivered today  — GREEN accent. Last 48h of deliveries
 *      by THIS runner. Collapsed by default — it's there as
 *      success confirmation + history, not an action surface.
 *
 *   4. 👥 Claimed by other runners — MUTED. Hidden when empty.
 *      Awareness only. carving_head + above can release.
 *
 * Mobile-first: From → To layout uses a CSS grid that collapses to
 * a single column on screens under 600px (arrow rotates to point
 * down). All buttons are 44px tap targets minimum.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  claimSlabTransferAction,
  claimSlabTransferBatchAction,
  unclaimSlabTransferAction,
  acknowledgeReceiptAction,
} from "../actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { batchTint } from "@/lib/batch-colours";

export type TransferRow = {
  id: string;
  slab_id: string;
  temple: string;
  slab_label: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  stock_location: string | null;
  vendor_id: string;
  vendor_name: string;
  vendor_type: "CNC" | "Manual";
  vendor_dropoff: string | null;
  urgency: "normal" | "urgent";
  assigned_at: string;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  /** Mig 065 — runners can claim up to 10 slabs in one click;
   *  every slab in the same claim shares this id so the "Claimed
   *  by me" section groups them as one truck-load. */
  claim_batch_id: string | null;
  is_lathe: boolean;
  /** Migration 026 — shared across slabs assigned together in a
   *  bulk assignment. Drives the coloured left stripe so the
   *  runner spots "these came together". */
  batch_id: string | null;
};

export type DeliveredRow = {
  id: string;
  slab_id: string;
  temple: string;
  slab_label: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  vendor_name: string;
  vendor_dropoff: string | null;
  delivered_at: string;
  dropoff_note: string | null;
  urgency: "normal" | "urgent";
  is_lathe: boolean;
};

// Single source of truth for the responsive breakpoint. Used by the
// route-visual grid and the button rows so they all collapse at the
// same width.
const MOBILE_CSS = `
  @keyframes mtcpl-transfer-flow {
    0%   { background-position: -40px 0; }
    100% { background-position: 40px 0; }
  }
  @media (max-width: 600px) {
    .mtcpl-route-grid {
      grid-template-columns: 1fr !important;
      grid-template-rows: auto auto auto;
    }
    .mtcpl-route-arrow {
      transform: rotate(90deg);
      width: 60px !important;
      margin: 0 auto;
    }
  }
`;

export function TransferDispatchList({
  rows,
  delivered,
  currentUserId,
  canUnclaimOthers,
  stoneTypes,
  toast,
}: {
  rows: TransferRow[];
  delivered: DeliveredRow[];
  currentUserId: string;
  canUnclaimOthers: boolean;
  stoneTypes: StoneTypeDef[];
  toast: string | null;
}) {
  const router = useRouter();
  const [toastMsg, setToastMsg] = useState<string | null>(toast);
  // Mig 065 — multi-select state for batch claim. Clearing rules:
  //   • Initial render → empty Set
  //   • Toggle a checkbox → add/remove
  //   • Submit → cleared by full reload (toast triggers nav refresh)
  // Capped at 10 selections (the batch cap); UI grays out further
  // checkboxes once you hit the cap.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const CLAIM_BATCH_MAX = 10;
  // Live ticker for the "⏱ claimed Xm ago" timer on Mine cards.
  // 15-second cadence keeps the display feel real without spamming
  // re-renders — slab transfers are minute-to-hour scale, not seconds.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-clear toast after 4 seconds.
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Strip ?toast=… so reload doesn't replay.
  useEffect(() => {
    if (toast && typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has("toast")) {
        url.searchParams.delete("toast");
        router.replace(url.pathname + url.search);
      }
    }
  }, [toast, router]);

  // CNC only — Manual vendors don't physically receive slabs.
  const cncRows = rows.filter((r) => r.vendor_type === "CNC");

  const mineRows = cncRows.filter((r) => r.claimed_by === currentUserId);
  const availableRows = cncRows.filter((r) => !r.claimed_by);
  const othersRows = cncRows.filter((r) => r.claimed_by && r.claimed_by !== currentUserId);

  // One-active-claim limit. While the runner has at least one slab
  // claimed (and not yet delivered), all Claim buttons on Available
  // rows are disabled with a hint to finish or release the current
  // one first. Server-side enforcement in claimSlabTransferAction is
  // the source of truth; this is the UX cue so the runner doesn't
  // even try to click.
  const hasActiveClaim = mineRows.length > 0;

  const sortByUrgency = (a: TransferRow, b: TransferRow) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
  };
  mineRows.sort(sortByUrgency);
  availableRows.sort(sortByUrgency);
  othersRows.sort(sortByUrgency);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <style>{MOBILE_CSS}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🚧 Slab Transfer</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Move cut slabs from the stock yard to each vendor&apos;s shade.
            Claim a slab before picking it up.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatTile label="Mine" value={mineRows.length} fg="#1d4ed8" />
          <StatTile label="To claim" value={availableRows.length} fg="#b45309" />
          <StatTile label="Delivered" value={delivered.length} fg="#15803d" />
        </div>
      </div>

      {toastMsg && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            background: "rgba(22,163,74,0.10)",
            border: "1px solid rgba(22,163,74,0.35)",
            color: "#15803d",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          ✓ {toastMsg}
        </div>
      )}

      {/* CLAIMED BY ME — primary actionable section.
          Mig 065 — when multiple slabs share a claim_batch_id, render
          them inside a single batch wrapper with a small header so the
          truck-load reads as one unit. Single-batch claims (or legacy
          NULL-batch rows from before mig 065) render as a group of 1. */}
      <SectionShell
        kind="mine"
        title="🚧 Claimed by me"
        subtitle={
          mineRows.length === 0
            ? "Nothing claimed yet — pick something from Available below."
            : `${mineRows.length} slab${mineRows.length !== 1 ? "s" : ""} to deliver`
        }
      >
        {mineRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(() => {
              // Group mineRows by claim_batch_id (legacy NULL rows
              // become their own per-row "batches").
              type Group = { batchId: string | null; rows: TransferRow[] };
              const groups: Group[] = [];
              const indexByKey = new Map<string, number>();
              for (const r of mineRows) {
                const key = r.claim_batch_id ?? `legacy::${r.id}`;
                const idx = indexByKey.get(key);
                if (idx == null) {
                  indexByKey.set(key, groups.length);
                  groups.push({ batchId: r.claim_batch_id, rows: [r] });
                } else {
                  groups[idx].rows.push(r);
                }
              }
              return groups.map((g, gIdx) => (
                <div
                  key={g.batchId ?? `legacy-${gIdx}`}
                  style={{
                    border: g.rows.length > 1 ? "1.5px solid #1d4ed8" : "none",
                    background: g.rows.length > 1 ? "rgba(29,78,216,0.04)" : "transparent",
                    borderRadius: g.rows.length > 1 ? 12 : 0,
                    padding: g.rows.length > 1 ? "10px 10px 12px" : 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {g.rows.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#1d4ed8",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span>🚛 Batch of {g.rows.length}</span>
                      {g.batchId && (
                        <code
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 10,
                            color: "rgba(29,78,216,0.6)",
                            fontWeight: 600,
                          }}
                        >
                          #{g.batchId.slice(0, 8)}
                        </code>
                      )}
                    </div>
                  )}
                  {g.rows.map((r) => (
                    <TransferCard
                      key={r.id}
                      row={r}
                      kind="mine"
                      stoneTypes={stoneTypes}
                      now={now}
                    />
                  ))}
                </div>
              ));
            })()}
          </div>
        )}
      </SectionShell>

      {/* AVAILABLE TO CLAIM — compact single-row layout. Each row
          shows all info inline (thumb + chips + slab id + temple +
          dims + from → to + Claim) so the runner can scan a long
          yard list quickly. Big card lives only on Mine where the
          runner is actively working. Claim buttons go disabled
          while the runner already has an active claim. */}
      <SectionShell
        kind="available"
        title="📦 Available to claim"
        subtitle={
          availableRows.length === 0
            ? "Yard is clear — nothing pending."
            : `${availableRows.length} slab${availableRows.length !== 1 ? "s" : ""} ready for pickup`
        }
        collapsible
        defaultOpen
      >
        {hasActiveClaim && availableRows.length > 0 && (
          <div
            style={{
              padding: "10px 12px",
              marginBottom: 10,
              background: "rgba(180,115,51,0.10)",
              border: "1.5px solid rgba(180,115,51,0.4)",
              borderRadius: 8,
              fontSize: 13,
              color: "#7c2d12",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 16 }}>🏗️</span>
            <span>
              Finish your current batch first — <strong>Mark delivered</strong> or
              <strong> Release claim</strong> on each above before opening a new batch.
            </span>
          </div>
        )}
        {/* Mig 065 — batch claim action bar. Shows the running tally
            of how many are selected, the 10-cap, and the submit
            button. Disappears when nothing's selected (or when the
            runner has an active claim). */}
        {!hasActiveClaim && availableRows.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              marginBottom: 10,
              background: selectedIds.size > 0 ? "#dbeafe" : "var(--surface-alt)",
              border: `1.5px solid ${selectedIds.size > 0 ? "#1d4ed8" : "var(--border)"}`,
              borderRadius: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: selectedIds.size > 0 ? "#1d4ed8" : "var(--muted)" }}>
              {selectedIds.size === 0
                ? `Select up to ${CLAIM_BATCH_MAX} slabs to claim as one batch`
                : `${selectedIds.size} / ${CLAIM_BATCH_MAX} selected`}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setSelectedIds(new Set())}
                  style={{ fontSize: 12, padding: "8px 14px", minHeight: 44 }}
                >
                  Clear
                </button>
              )}
              <form
                action={claimSlabTransferBatchAction}
                onSubmit={() => {
                  // Optimistically clear selection — page reload will
                  // re-fetch with the freshly claimed rows in Mine.
                  setSelectedIds(new Set());
                }}
              >
                <input
                  type="hidden"
                  name="carving_item_ids"
                  value={JSON.stringify([...selectedIds])}
                />
                <input type="hidden" name="redirect_to" value="/carving/transfer" />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={selectedIds.size === 0}
                  style={{
                    fontSize: 14,
                    padding: "10px 20px",
                    fontWeight: 700,
                    minHeight: 44,
                    opacity: selectedIds.size === 0 ? 0.5 : 1,
                    cursor: selectedIds.size === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  📦 Claim {selectedIds.size > 0 ? `${selectedIds.size} slab${selectedIds.size === 1 ? "" : "s"}` : "selected"}
                </button>
              </form>
            </div>
          </div>
        )}
        {availableRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {availableRows.map((r) => {
              const isSelected = selectedIds.has(r.id);
              const atCap = selectedIds.size >= CLAIM_BATCH_MAX && !isSelected;
              return (
                <CompactRow
                  key={r.id}
                  row={r}
                  kind="available"
                  stoneTypes={stoneTypes}
                  disabledReason={
                    hasActiveClaim
                      ? "Deliver or release your current batch first"
                      : atCap
                        ? `Max ${CLAIM_BATCH_MAX} per batch — claim what's selected first`
                        : null
                  }
                  selected={isSelected}
                  selectDisabled={hasActiveClaim || atCap}
                  onToggleSelect={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else if (next.size < CLAIM_BATCH_MAX) next.add(r.id);
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </SectionShell>

      {/* DELIVERED TODAY — success confirmation, collapsed by default. */}
      {delivered.length > 0 && (
        <SectionShell
          kind="delivered"
          title="✅ Delivered today"
          subtitle={`${delivered.length} slab${delivered.length !== 1 ? "s" : ""} delivered in the last 48 hours`}
          collapsible
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {delivered.map((d) => (
              <DeliveredCard key={d.id} row={d} stoneTypes={stoneTypes} />
            ))}
          </div>
        </SectionShell>
      )}

      {/* CLAIMED BY OTHERS — hidden when empty. Same compact row
          format as Available since this is awareness-only. */}
      {othersRows.length > 0 && (
        <SectionShell
          kind="others"
          title="👥 Claimed by other runners"
          subtitle="Already grabbed — visible for awareness only."
          collapsible
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {othersRows.map((r) => (
              <CompactRow
                key={r.id}
                row={r}
                kind="others"
                canUnclaim={canUnclaimOthers}
                stoneTypes={stoneTypes}
              />
            ))}
          </div>
        </SectionShell>
      )}
    </div>
  );
}

// ── Section shell — strong visual differentiation per kind ────────

type SectionKind = "mine" | "available" | "delivered" | "others";

const SECTION_TINTS: Record<
  SectionKind,
  { bg: string; border: string; titleFg: string; subtitleFg: string }
> = {
  mine: {
    bg: "linear-gradient(180deg, rgba(37,99,235,0.07) 0%, rgba(37,99,235,0.02) 100%)",
    border: "rgba(37,99,235,0.40)",
    titleFg: "#1d4ed8",
    subtitleFg: "#1e3a8a",
  },
  available: {
    bg: "var(--surface)",
    border: "var(--border)",
    titleFg: "#b45309",
    subtitleFg: "var(--muted)",
  },
  delivered: {
    bg: "rgba(22,163,74,0.06)",
    border: "rgba(22,163,74,0.35)",
    titleFg: "#15803d",
    subtitleFg: "var(--muted)",
  },
  others: {
    bg: "var(--surface-alt)",
    border: "var(--border)",
    titleFg: "var(--muted)",
    subtitleFg: "var(--muted)",
  },
};

function SectionShell({
  kind,
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  kind: SectionKind;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const tint = SECTION_TINTS[kind];
  return (
    <section
      style={{
        background: tint.bg,
        border: `1.5px solid ${tint.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: kind === "mine" ? "0 2px 12px rgba(37,99,235,0.08)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: isOpen ? 12 : 0,
          flexWrap: "wrap",
          cursor: collapsible ? "pointer" : "default",
          userSelect: collapsible ? "none" : "auto",
        }}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
      >
        {collapsible && (
          <span style={{ fontSize: 12, color: tint.titleFg, width: 14, display: "inline-block" }}>
            {isOpen ? "▼" : "▶"}
          </span>
        )}
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: tint.titleFg }}>{title}</h2>
        <span style={{ fontSize: 12, color: tint.subtitleFg }}>{subtitle}</span>
      </div>
      {isOpen && children}
    </section>
  );
}

// ── Transfer card — actionable row in Mine / Available / Others ───

function TransferCard({
  row,
  kind,
  canUnclaim,
  stoneTypes,
  disabledReason,
  now,
}: {
  row: TransferRow;
  kind: "mine" | "available" | "others";
  canUnclaim?: boolean;
  stoneTypes: StoneTypeDef[];
  /** When set, the Claim button on an Available row is disabled
   *  and shows this hint as a tooltip + greyed out style. Used to
   *  enforce the one-active-claim-per-runner rule. */
  disabledReason?: string | null;
  /** Wall-clock millis. Drives the live "claimed Xm ago" ticker on
   *  Mine cards. Only required when kind === "mine". */
  now?: number;
}) {
  const [deliverOpen, setDeliverOpen] = useState(false);
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const isUrgent = row.urgency === "urgent";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(row.batch_id);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderRadius: 10,
        boxShadow: isUrgent ? "0 0 0 2px rgba(220,38,38,0.08)" : "none",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      {/* Top row — slab info + chips */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0 }}>
          <SlabThumb
            stone={row.stone}
            l={row.length_ft}
            w={row.width_ft}
            t={row.thickness_ft}
            stoneTypes={stoneTypes}
            size={64}
            height={64}
          />
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {isUrgent && <ChipUrgent />}
            {row.is_lathe && <ChipLathe />}
            <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
              {row.slab_id}
            </code>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
            {row.temple}
            {row.slab_label && ` · ${row.slab_label}`}
            <div style={{ marginTop: 2, fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
              {dims}
            </div>
          </div>
          {kind === "others" && row.claimed_by_name && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Claimed by <strong>{row.claimed_by_name}</strong>
              {row.claimed_at && ` · ${formatRelative(row.claimed_at)} ago`}
            </div>
          )}
        </div>
      </div>

      {/* Live "claimed Xm ago" timer — only for Mine rows. Turns
          amber after 15min and red after 30min as a "did the
          runner get distracted?" nudge. Uses `now` from the parent
          ticker so it refreshes every 15s without local state. */}
      {kind === "mine" && now != null && row.claimed_at && (
        <ClaimedTimer claimedAt={row.claimed_at} now={now} />
      )}

      {/* Route visualisation */}
      <RouteVisual
        from={row.stock_location}
        toVendor={row.vendor_name}
        toDropoff={row.vendor_dropoff}
        active={kind === "mine"}
      />

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        {kind === "available" && (
          <form action={claimSlabTransferAction} style={{ flex: 1, minWidth: 120 }}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <button
              type="submit"
              className="primary-button"
              disabled={!!disabledReason}
              title={disabledReason ?? undefined}
              style={{
                width: "100%",
                fontSize: 14,
                padding: "12px 20px",
                fontWeight: 700,
                minHeight: 44,
                opacity: disabledReason ? 0.45 : 1,
                cursor: disabledReason ? "not-allowed" : "pointer",
              }}
            >
              {disabledReason ? "🏗️ Deliver current first" : "📦 Claim this slab"}
            </button>
          </form>
        )}
        {kind === "mine" && !deliverOpen && (
          <>
            <button
              type="button"
              onClick={() => setDeliverOpen(true)}
              style={{
                flex: 1,
                minWidth: 160,
                fontSize: 14,
                padding: "12px 20px",
                fontWeight: 700,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                minHeight: 44,
                boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
              }}
            >
              ✅ Mark delivered
            </button>
            <form action={unclaimSlabTransferAction}>
              <input type="hidden" name="carving_item_id" value={row.id} />
              <input type="hidden" name="redirect_to" value="/carving/transfer" />
              <button
                type="submit"
                className="ghost-button"
                style={{ fontSize: 12, padding: "10px 14px", minHeight: 44 }}
              >
                Release claim
              </button>
            </form>
          </>
        )}
        {kind === "mine" && deliverOpen && (
          <form
            action={acknowledgeReceiptAction}
            style={{ display: "flex", gap: 6, alignItems: "stretch", flex: 1, flexWrap: "wrap" }}
          >
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <input
              type="text"
              name="dropoff_note"
              placeholder={`Where? (empty = ${row.vendor_dropoff ?? "standard spot"})`}
              style={{
                fontSize: 13,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--text)",
                flex: "1 1 180px",
                minWidth: 140,
                minHeight: 44,
              }}
            />
            <button
              type="submit"
              style={{
                fontSize: 13,
                padding: "10px 18px",
                fontWeight: 700,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                minHeight: 44,
              }}
            >
              ✅ Done
            </button>
            <button
              type="button"
              onClick={() => setDeliverOpen(false)}
              className="ghost-button"
              style={{ fontSize: 12, padding: "10px 14px", minHeight: 44 }}
            >
              Cancel
            </button>
          </form>
        )}
        {kind === "others" && canUnclaim && (
          <form action={unclaimSlabTransferAction}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <button
              type="submit"
              className="ghost-button danger-ghost"
              style={{ fontSize: 12, padding: "8px 14px" }}
            >
              Release their claim
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Compact row — single-line layout for Available + Others ──────
//
// Tight Excel-style row: small thumb · chips · slab id · temple ·
// dims · 📍 from → 🏭 vendor · action button.
// Wraps to multi-line on narrow screens (CSS gap + flex-wrap), but
// stays one line per slab on desktop so the runner can scan a long
// yard list at a glance. The big card with the animated arrow
// route is reserved for "Claimed by me" — the active work.
function CompactRow({
  row,
  kind,
  canUnclaim,
  stoneTypes,
  disabledReason,
  selected,
  onToggleSelect,
  selectDisabled,
}: {
  row: TransferRow;
  kind: "available" | "others";
  canUnclaim?: boolean;
  stoneTypes: StoneTypeDef[];
  disabledReason?: string | null;
  /** Mig 065 — for `kind="available"`, the row renders a checkbox
   *  instead of an inline Claim button. Parent owns the selected-set
   *  state; the row just toggles entries via this callback. */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** When the user has already hit the batch cap (10) or has an
   *  active claim, the checkbox is disabled. Tooltip explains. */
  selectDisabled?: boolean;
}) {
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const isUrgent = row.urgency === "urgent";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(row.batch_id);
  return (
    <div
      style={{
        // Locked 3-column layout: [thumb] [info, grows] [button].
        // The middle column has min-width: 0 so long temple names
        // truncate with ellipsis instead of pushing the button to a
        // new line. This keeps every Claim button vertically aligned
        // down the right edge of the list.
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderRadius: 8,
        boxShadow: isUrgent ? "0 0 0 2px rgba(220,38,38,0.06)" : "none",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      {/* Thumb */}
      <div style={{ flexShrink: 0 }}>
        <SlabThumb
          stone={row.stone}
          l={row.length_ft}
          w={row.width_ft}
          t={row.thickness_ft}
          stoneTypes={stoneTypes}
          size={56}
          height={56}
        />
      </div>

      {/* Middle column: three info lines, all left-aligned. Truncates
          on overflow so the button never gets pushed off the row. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Line 1 — chips + slab id + dims (the prominent line) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isUrgent && <ChipUrgent />}
          {row.is_lathe && <ChipLathe small />}
          <code
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              fontSize: 15,
              color: "var(--text)",
            }}
          >
            {row.slab_id}
          </code>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text)",
              background: "var(--surface-alt)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            {dims}
          </span>
        </div>

        {/* Line 2 — temple + label, secondary */}
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}
          title={`${row.temple}${row.slab_label ? " · " + row.slab_label : ""}`}
        >
          🏛 {row.temple}
          {row.slab_label && ` · ${row.slab_label}`}
        </div>

        {/* Line 3 — from → to route, monospace */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            flexWrap: "wrap",
            color: "var(--muted)",
          }}
        >
          <span style={{ color: "#7c2d12", fontWeight: 700 }}>
            📍 {row.stock_location ?? "—"}
          </span>
          <span style={{ color: "var(--muted-light)", fontWeight: 700 }}>→</span>
          <span style={{ color: "#15803d", fontWeight: 700 }}>
            🏭 {row.vendor_name}
            {row.vendor_dropoff && (
              <span style={{ color: "#15803d", fontWeight: 400 }}> · {row.vendor_dropoff}</span>
            )}
          </span>
          {kind === "others" && row.claimed_by_name && (
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 10 }}>
              · Claimed by <strong>{row.claimed_by_name}</strong>
              {row.claimed_at && ` · ${formatRelative(row.claimed_at)} ago`}
            </span>
          )}
        </div>
      </div>

      {/* Right column — Mig 065: checkbox replaces the per-row
          Claim button. Selection feeds the batch-claim action bar
          above (max 10 per batch). When the user has an active
          claim OR the cap is reached, the checkbox disables with
          a tooltip explaining. */}
      {kind === "available" && (
        <label
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            minWidth: 44,
            minHeight: 44,
            padding: "0 12px",
            border: `1.5px solid ${selected ? "#1d4ed8" : "var(--border)"}`,
            background: selected ? "#dbeafe" : "var(--surface)",
            borderRadius: 8,
            cursor: selectDisabled ? "not-allowed" : "pointer",
            opacity: selectDisabled && !selected ? 0.4 : 1,
            transition: "background 0.12s, border-color 0.12s",
          }}
          title={
            selectDisabled && !selected
              ? disabledReason ?? "Cap reached — claim what's selected first"
              : selected
                ? "Tap to deselect"
                : "Tap to add to claim batch"
          }
        >
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            disabled={!!selectDisabled && !selected}
            style={{ width: 20, height: 20, cursor: "inherit" }}
            aria-label={`${selected ? "Deselect" : "Select"} slab ${row.slab_id} for batch claim`}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: selected ? "#1d4ed8" : "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            {selected ? "Selected" : "Select"}
          </span>
        </label>
      )}
      {kind === "others" && canUnclaim && (
        <form action={unclaimSlabTransferAction} style={{ flexShrink: 0 }}>
          <input type="hidden" name="carving_item_id" value={row.id} />
          <input type="hidden" name="redirect_to" value="/carving/transfer" />
          <button
            type="submit"
            className="ghost-button danger-ghost"
            style={{ fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap" }}
          >
            Release
          </button>
        </form>
      )}
    </div>
  );
}

// ── Delivered card — success confirmation row ─────────────────────

function DeliveredCard({ row, stoneTypes }: { row: DeliveredRow; stoneTypes: StoneTypeDef[] }) {
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const deliveredAt = new Date(row.delivered_at);
  const ist = deliveredAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ageMin = (Date.now() - deliveredAt.getTime()) / 60000;
  const isFresh = ageMin < 60;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 12px",
        background: "var(--surface)",
        border: `1px solid ${isFresh ? "rgba(22,163,74,0.45)" : "var(--border)"}`,
        borderRadius: 8,
        alignItems: "center",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <SlabThumb
          stone={row.stone}
          l={row.length_ft}
          w={row.width_ft}
          t={row.thickness_ft}
          stoneTypes={stoneTypes}
          size={44}
          height={44}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 16,
              color: "#15803d",
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            ✓
          </span>
          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
            {row.slab_id}
          </code>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {row.temple}
            {row.slab_label && ` · ${row.slab_label}`}
            {" · "}
            {dims}
          </span>
          {row.is_lathe && <ChipLathe small />}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 4,
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          <span>
            🏭 <strong style={{ color: "var(--text)" }}>{row.vendor_name}</strong>
            {row.dropoff_note ? (
              <span style={{ color: "#15803d" }}> · 📍 {row.dropoff_note}</span>
            ) : row.vendor_dropoff ? (
              <span> · {row.vendor_dropoff}</span>
            ) : null}
          </span>
          <span style={{ color: "#15803d", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
            ✅ {ist}
            {isFresh && ageMin < 60 && <span style={{ marginLeft: 4 }}>· just now</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Route visualisation — From → To, animated when claimed ────────

function RouteVisual({
  from,
  toVendor,
  toDropoff,
  active,
}: {
  from: string | null;
  toVendor: string;
  toDropoff: string | null;
  active: boolean;
}) {
  return (
    <div
      className="mtcpl-route-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 60px 1fr",
        gap: 8,
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          background: "rgba(180,115,51,0.10)",
          border: "1px solid rgba(180,115,51,0.35)",
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: "#92400e",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          📍 From (where it is)
        </span>
        <strong
          style={{
            fontSize: 13,
            color: "#7c2d12",
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-word",
          }}
        >
          {from ?? "(no location set)"}
        </strong>
      </div>

      <div
        className="mtcpl-route-arrow"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          height: 44,
        }}
      >
        <div
          style={{
            width: "100%",
            height: 6,
            borderRadius: 3,
            background: active
              ? "repeating-linear-gradient(90deg, #16a34a 0 10px, #86efac 10px 20px)"
              : "var(--border)",
            backgroundSize: active ? "40px 6px" : undefined,
            animation: active ? "mtcpl-transfer-flow 0.8s linear infinite" : undefined,
          }}
        />
        <span
          style={{
            position: "absolute",
            fontSize: 20,
            color: active ? "#15803d" : "var(--muted)",
            background: "var(--surface)",
            padding: "0 6px",
            fontWeight: 800,
          }}
        >
          →
        </span>
      </div>

      <div
        style={{
          background: "rgba(22,163,74,0.10)",
          border: "1px solid rgba(22,163,74,0.35)",
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: "#15803d",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          🏭 To (deliver to)
        </span>
        <strong
          style={{
            fontSize: 13,
            color: "#14532d",
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-word",
          }}
        >
          {toVendor}
        </strong>
        {toDropoff && (
          <span style={{ fontSize: 11, color: "#15803d" }}>{toDropoff}</span>
        )}
      </div>
    </div>
  );
}

// ── Live timer for "Claimed by me" rows ───────────────────────────
//
// Counts up from claimed_at. Tone changes based on duration so the
// runner sees a visual nudge if they've been on this slab too long:
//   < 15 min — green   (normal, all good)
//   15-30 min — amber  (taking a while, double-check the route)
//   > 30 min — red     (probably forgot or got pulled into something)
function ClaimedTimer({ claimedAt, now }: { claimedAt: string; now: number }) {
  const elapsedMin = Math.max(0, (now - new Date(claimedAt).getTime()) / 60000);
  const tone =
    elapsedMin >= 30
      ? { fg: "#991b1b", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.4)", icon: "⚠" }
      : elapsedMin >= 15
        ? { fg: "#92400e", bg: "rgba(217,119,6,0.10)", border: "rgba(217,119,6,0.4)", icon: "⏳" }
        : { fg: "#15803d", bg: "rgba(22,163,74,0.10)", border: "rgba(22,163,74,0.4)", icon: "⏱" };
  const label = fmtElapsed(elapsedMin);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 10px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        color: tone.fg,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <span>
        {tone.icon} Claimed {label} ago
      </span>
      {elapsedMin >= 15 && (
        <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
          {elapsedMin >= 30 ? "taking long — check?" : "in transit"}
        </span>
      )}
    </div>
  );
}

function fmtElapsed(mins: number): string {
  const m = Math.floor(mins);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// ── Tiny chips + helpers ──────────────────────────────────────────

function ChipUrgent() {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        padding: "2px 7px",
        borderRadius: 999,
        background: "#dc2626",
        color: "#fff",
        letterSpacing: "0.05em",
      }}
    >
      ⚡ URGENT
    </span>
  );
}

function ChipLathe({ small = false }: { small?: boolean }) {
  return (
    <span
      style={{
        fontSize: small ? 8 : 9,
        fontWeight: 800,
        padding: small ? "1px 5px" : "2px 6px",
        borderRadius: 3,
        background: "rgba(124,58,237,0.15)",
        color: "#7c3aed",
        letterSpacing: "0.05em",
      }}
    >
      🌀 LATHE
    </span>
  );
}

function StatTile({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "8px 14px",
        background: "var(--surface-alt)",
        borderRadius: 8,
        textAlign: "center",
        minWidth: 70,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: fg,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
