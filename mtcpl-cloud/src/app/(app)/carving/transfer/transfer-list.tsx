"use client";

/**
 * Slab Transfer dispatch UI.
 *
 * Three sections rendered top-down:
 *   1. Claimed by me (with Deliver / Unclaim buttons + optional note)
 *   2. Available to claim (📦 Claim button per row)
 *   3. Claimed by others (read-only; carving_head + owner + dev see
 *      an Unclaim button so they can redirect)
 *
 * Each row carries: 3D slab thumbnail, slab id, temple, dims, lathe
 * chip, urgency chip, pickup location (slab_requirements.stock_location),
 * drop-off location (vendors.dropoff_location), and vendor name.
 *
 * Marked "use client" because the deliver form per claimed row has
 * a local "dropoff_note" text input + show/hide state. Claim and
 * unclaim are plain server-action forms.
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

export function TransferDispatchList({
  rows,
  currentUserId,
  canUnclaimOthers,
  stoneTypes,
  toast,
}: {
  rows: TransferRow[];
  currentUserId: string;
  canUnclaimOthers: boolean;
  stoneTypes: StoneTypeDef[];
  toast: string | null;
}) {
  const router = useRouter();
  const [toastMsg, setToastMsg] = useState<string | null>(toast);

  // Auto-clear toast after 4 seconds.
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Strip ?toast=... once we've shown it so reload doesn't replay.
  useEffect(() => {
    if (toast && typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has("toast")) {
        url.searchParams.delete("toast");
        router.replace(url.pathname + url.search);
      }
    }
  }, [toast, router]);

  // Filter into three buckets — CNC only because Manual vendors don't
  // physically receive slabs the same way (the head fires Mark
  // started on their behalf elsewhere).
  const cncRows = rows.filter((r) => r.vendor_type === "CNC");

  const mineRows = cncRows.filter((r) => r.claimed_by === currentUserId);
  const availableRows = cncRows.filter((r) => !r.claimed_by);
  const othersRows = cncRows.filter((r) => r.claimed_by && r.claimed_by !== currentUserId);

  // Sort each bucket: urgent first, then oldest assigned first.
  const sortByUrgency = (a: TransferRow, b: TransferRow) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
  };
  mineRows.sort(sortByUrgency);
  availableRows.sort(sortByUrgency);
  othersRows.sort(sortByUrgency);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🚧 Slab Transfer</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Move cut slabs from the stock yard to each vendor&apos;s shade.
            Claim a slab before picking it up so no one else grabs the same one.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatTile label="To claim" value={availableRows.length} fg="#b45309" />
          <StatTile label="Mine" value={mineRows.length} fg="#1d4ed8" />
          <StatTile label="Others" value={othersRows.length} fg="var(--muted)" />
        </div>
      </div>

      {toastMsg && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            background: "rgba(22,163,74,0.08)",
            border: "1px solid rgba(22,163,74,0.25)",
            color: "#15803d",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ {toastMsg}
        </div>
      )}

      <Section
        title="Claimed by me"
        subtitle={mineRows.length === 0 ? "Nothing claimed — pick something below." : `${mineRows.length} slab${mineRows.length !== 1 ? "s" : ""} to deliver`}
        accent="#1d4ed8"
      >
        {mineRows.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mineRows.map((r) => (
              <TransferCard key={r.id} row={r} kind="mine" stoneTypes={stoneTypes} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Available to claim"
        subtitle={availableRows.length === 0 ? "Nothing pending — yard is clear." : `${availableRows.length} slab${availableRows.length !== 1 ? "s" : ""} ready for pickup`}
        accent="#b45309"
      >
        {availableRows.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {availableRows.map((r) => (
              <TransferCard key={r.id} row={r} kind="available" stoneTypes={stoneTypes} />
            ))}
          </div>
        )}
      </Section>

      {othersRows.length > 0 && (
        <Section
          title="Claimed by other runners"
          subtitle="Already grabbed — visible for awareness only."
          accent="var(--muted)"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
        </Section>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────

function TransferCard({
  row,
  kind,
  canUnclaim,
  stoneTypes,
}: {
  row: TransferRow;
  kind: "mine" | "available" | "others";
  canUnclaim?: boolean;
  stoneTypes: StoneTypeDef[];
}) {
  const [deliverOpen, setDeliverOpen] = useState(false);

  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const isUrgent = row.urgency === "urgent";

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        background: isUrgent ? "rgba(220,38,38,0.04)" : "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
        borderRadius: 10,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {/* 3D slab thumbnail */}
      <div style={{ flexShrink: 0 }}>
        <SlabThumb
          stone={row.stone}
          l={row.length_ft}
          w={row.width_ft}
          t={row.thickness_ft}
          stoneTypes={stoneTypes}
          size={70}
          height={70}
        />
      </div>

      {/* Slab info + locations */}
      <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isUrgent && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: "#dc2626", color: "#fff", letterSpacing: "0.05em" }}>
              ⚡ URGENT
            </span>
          )}
          {row.is_lathe && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: "rgba(124,58,237,0.15)", color: "#7c3aed", letterSpacing: "0.05em" }}>
              🌀 LATHE
            </span>
          )}
          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 14 }}>
            {row.slab_id}
          </code>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {row.temple}
            {row.slab_label && ` · ${row.slab_label}`}
            {" · "}
            {dims}
          </span>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text)", flexWrap: "wrap" }}>
          <div>
            <span className="muted" style={{ fontSize: 11 }}>From: </span>
            <strong style={{ color: "#7c2d12", fontFamily: "ui-monospace, monospace" }}>
              📍 {row.stock_location ?? "(no location set)"}
            </strong>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 11 }}>To: </span>
            <strong style={{ color: "#15803d", fontFamily: "ui-monospace, monospace" }}>
              🏭 {row.vendor_name}
              {row.vendor_dropoff && ` · ${row.vendor_dropoff}`}
            </strong>
          </div>
        </div>
        {kind === "others" && row.claimed_by_name && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Claimed by <strong>{row.claimed_by_name}</strong>
            {row.claimed_at && ` · ${formatRelative(row.claimed_at)} ago`}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", minWidth: 180 }}>
        {kind === "available" && (
          <form action={claimSlabTransferAction}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <button
              type="submit"
              className="primary-button"
              style={{ fontSize: 12, padding: "8px 14px", width: "100%", fontWeight: 700 }}
            >
              📦 Claim
            </button>
          </form>
        )}
        {kind === "mine" && !deliverOpen && (
          <>
            <button
              type="button"
              onClick={() => setDeliverOpen(true)}
              style={{
                fontSize: 12,
                padding: "8px 14px",
                width: "100%",
                fontWeight: 700,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
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
                style={{ fontSize: 11, padding: "5px 10px", width: "100%" }}
              >
                Release claim
              </button>
            </form>
          </>
        )}
        {kind === "mine" && deliverOpen && (
          <form action={acknowledgeReceiptAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <input
              type="text"
              name="dropoff_note"
              placeholder="Where did you leave it? (optional)"
              style={{
                fontSize: 12,
                padding: "6px 8px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
              }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="submit"
                className="primary-button"
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  fontWeight: 700,
                  background: "#16a34a",
                  flex: 1,
                }}
              >
                ✅ Done
              </button>
              <button
                type="button"
                onClick={() => setDeliverOpen(false)}
                className="ghost-button"
                style={{ fontSize: 11, padding: "6px 10px" }}
              >
                Cancel
              </button>
            </div>
            <span style={{ fontSize: 10, color: "var(--muted-light)" }}>
              Empty = dropped at standard location ({row.vendor_dropoff ?? row.vendor_name})
            </span>
          </form>
        )}
        {kind === "others" && canUnclaim && (
          <form action={unclaimSlabTransferAction}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <button
              type="submit"
              className="ghost-button danger-ghost"
              style={{ fontSize: 11, padding: "6px 10px", width: "100%" }}
            >
              Release their claim
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section className="page-card">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, color: accent }}>{title}</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</span>
      </div>
      {children}
    </section>
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
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: fg, fontFamily: "ui-monospace, monospace" }}>
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
