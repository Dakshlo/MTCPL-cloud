"use client";

/**
 * Receive carved Outsource slabs — Daksh June 2026.
 *
 * Opened from the 📥 Receive button on an Outsource Active card. Instead
 * of the old one-tap form submit (easy to fire by accident), this modal:
 *   • Pre-selects the slab whose card was tapped.
 *   • Lets the carving head tick up to 8 returned slabs and receive them
 *     all in ONE press (each becomes status=completed → Carving Done
 *     Approval).
 *   • Requires a deliberate two-tap confirm so a stray click can't mark
 *     a slab received.
 *
 * Outsource-only. CNC slabs never reach this surface.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { receiveOutsourceCarvingBatchAction } from "./actions";

export type ReceivableJob = {
  /** carving_items.id */
  id: string;
  /** slab_requirement_id — the human slab code shown on the card */
  slab_id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  vendor_name: string;
};

const MAX_RECEIVE = 8;

function PendingOverlay() {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label="Receiving slabs…" />;
}

export function ReceiveModal({
  jobs,
  initialId,
  onClose,
}: {
  jobs: ReceivableJob[];
  initialId?: string | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialId && jobs.some((j) => j.id === initialId) ? [initialId] : []),
  );
  const [armed, setArmed] = useState(false);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Any change to the selection disarms the confirm so the user always
  // confirms the exact set they're about to receive.
  useEffect(() => {
    setArmed(false);
  }, [selected]);

  const atCap = selected.size >= MAX_RECEIVE;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_RECEIVE) next.add(id);
      return next;
    });
  }

  // Group rows by vendor so a head receiving from one carver sees them
  // together.
  const grouped = useMemo(() => {
    const m = new Map<string, ReceivableJob[]>();
    for (const j of jobs) {
      const arr = m.get(j.vendor_name) ?? [];
      arr.push(j);
      m.set(j.vendor_name, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [jobs]);

  const idsJson = JSON.stringify([...selected]);
  const count = selected.size;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: "var(--content-left)",
        right: 0,
        bottom: 0,
        background: "rgba(15, 12, 6, 0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "6vh",
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 560,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>📥 Receive carved slabs</h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              Mark slabs returned from the vendor — they move to{" "}
              <strong>Carving Done Approval</strong>. Select up to {MAX_RECEIVE}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 18,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              padding: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Count strip */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "#fff",
              background: count ? "#15803d" : "var(--border)",
              borderRadius: 999,
              padding: "3px 12px",
            }}
          >
            {count} / {MAX_RECEIVE} selected
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#991b1b",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {jobs.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No slabs are out with vendors right now.
            </div>
          ) : (
            grouped.map(([vendorName, rows]) => (
              <Fragment key={vendorName}>
                <div
                  style={{
                    padding: "8px 18px 4px",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#92400e",
                  }}
                >
                  🤝 {vendorName}
                </div>
                {rows.map((j) => {
                  const on = selected.has(j.id);
                  const blocked = !on && atCap;
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => toggle(j.id)}
                      disabled={blocked}
                      title={blocked ? `You can receive up to ${MAX_RECEIVE} at once` : undefined}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 18px",
                        background: on ? "rgba(22,163,74,0.07)" : "transparent",
                        border: "none",
                        borderTop: "1px solid var(--border)",
                        cursor: blocked ? "not-allowed" : "pointer",
                        opacity: blocked ? 0.5 : 1,
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          borderRadius: 5,
                          border: `2px solid ${on ? "#15803d" : "var(--border)"}`,
                          background: on ? "#15803d" : "transparent",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 900,
                        }}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                          {j.slab_id}
                        </span>
                        {j.label ? <span style={{ fontSize: 13 }}> · {j.label}</span> : ""}
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>
                          {j.temple}
                          {j.stone ? ` · ${j.stone}` : ""} · {j.length_ft}×{j.width_ft}×{j.thickness_ft}&Prime;
                        </span>
                      </span>
                    </button>
                  );
                })}
              </Fragment>
            ))
          )}
        </div>

        {/* Footer — two-tap confirm */}
        <form
          action={receiveOutsourceCarvingBatchAction}
          style={{
            position: "relative",
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
          }}
        >
          <PendingOverlay />
          <input type="hidden" name="carving_item_ids" value={idsJson} />
          <input type="hidden" name="redirect_to" value="/carving?tab=active&mode=outsource" />
          {armed && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>
              Tap again to confirm
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          {armed ? (
            <button
              type="submit"
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 800,
                color: "#fff",
                background: "#15803d",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              ✓ Confirm — Receive {count}
            </button>
          ) : (
            <button
              type="button"
              disabled={count === 0}
              onClick={() => setArmed(true)}
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 800,
                color: "#fff",
                background: count === 0 ? "var(--border)" : "#16a34a",
                border: "none",
                borderRadius: 8,
                cursor: count === 0 ? "not-allowed" : "pointer",
              }}
            >
              📥 Receive {count > 0 ? `${count} slab${count === 1 ? "" : "s"}` : "slabs"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
