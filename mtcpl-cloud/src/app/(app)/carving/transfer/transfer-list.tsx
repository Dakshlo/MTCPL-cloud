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
  unclaimSlabTransferAction,
  acknowledgeReceiptAction,
} from "../actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";

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
  is_lathe: boolean;
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

      {/* CLAIMED BY ME — primary actionable section. */}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mineRows.map((r) => (
              <TransferCard
                key={r.id}
                row={r}
                kind="mine"
                stoneTypes={stoneTypes}
                now={now}
              />
            ))}
          </div>
        )}
      </SectionShell>

      {/* AVAILABLE TO CLAIM — secondary, amber. Claim buttons are
          disabled while the runner has an active claim (one-at-a-
          time crane workflow). Banner explains why. */}
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
              Finish your current slab first — <strong>Mark delivered</strong> or
              <strong> Release claim</strong> above before picking the next one.
            </span>
          </div>
        )}
        {availableRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {availableRows.map((r) => (
              <TransferCard
                key={r.id}
                row={r}
                kind="available"
                stoneTypes={stoneTypes}
                disabledReason={hasActiveClaim ? "Deliver or release your current slab first" : null}
              />
            ))}
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

      {/* CLAIMED BY OTHERS — hidden when empty. */}
      {othersRows.length > 0 && (
        <SectionShell
          kind="others"
          title="👥 Claimed by other runners"
          subtitle="Already grabbed — visible for awareness only."
          collapsible
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {othersRows.map((r) => (
              <TransferCard
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderRadius: 10,
        boxShadow: isUrgent ? "0 0 0 2px rgba(220,38,38,0.08)" : "none",
      }}
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

// ── Delivered card — success confirmation row ─────────────────────

function DeliveredCard({ row, stoneTypes }: { row: DeliveredRow; stoneTypes: StoneTypeDef[] }) {
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const deliveredAt = new Date(row.delivered_at);
  const ist = deliveredAt.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
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
