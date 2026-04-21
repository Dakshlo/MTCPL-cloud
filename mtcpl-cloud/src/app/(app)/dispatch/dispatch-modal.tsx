"use client";

/**
 * Modal shown when the developer clicks "Dispatch selected" on a
 * temple section in the Ready tab. Captures vehicle + driver info
 * and submits a form that creates the dispatches row + N
 * dispatch_logs + flips the slabs to status=dispatched.
 */

import { useState } from "react";
import { createDispatchAction } from "./actions";

type SelectedSlab = {
  id: string;
  label: string | null;
  dimensions: string;
  cft: number;
};

export function DispatchModal({
  temple,
  selectedSlabs,
  onClose,
}: {
  temple: string;
  selectedSlabs: SelectedSlab[];
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const totalCft = selectedSlabs.reduce((sum, s) => sum + s.cft, 0);

  return (
    <>
      <div className="drawer-backdrop" onClick={submitting ? undefined : onClose} />
      <div
        className="edit-drawer"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-label="Create Dispatch"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">🚚 New Dispatch</div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {selectedSlabs.length} slab{selectedSlabs.length !== 1 ? "s" : ""} · {totalCft.toFixed(2)} CFT
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} disabled={submitting}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <form
            action={(fd) => {
              setSubmitting(true);
              return createDispatchAction(fd);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <input type="hidden" name="temple" value={temple} />
            <input type="hidden" name="slab_ids" value={JSON.stringify(selectedSlabs.map((s) => s.id))} />

            <div
              style={{
                background: "rgba(184,115,51,0.08)",
                border: "1px solid rgba(184,115,51,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Destination
              </div>
              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14 }}>
                🏛 {temple}
              </div>
            </div>

            <label className="stack">
              <span>Vehicle No. <span style={{ color: "#DC2626" }}>*</span></span>
              <input
                name="vehicle_no"
                placeholder="e.g. RJ-14-AB-1234"
                required
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onInput={(e) => {
                  const el = e.currentTarget;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  el.value = el.value.toUpperCase();
                  // Restore caret so typing in the middle doesn't jump to end.
                  if (start !== null && end !== null) el.setSelectionRange(start, end);
                }}
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label className="stack" style={{ flex: "1 1 180px" }}>
                <span>Driver Name <span style={{ color: "#DC2626" }}>*</span></span>
                <input name="driver_name" placeholder="e.g. Ramesh" required />
              </label>
              <label className="stack" style={{ flex: "1 1 140px" }}>
                <span>Driver Phone</span>
                <input name="driver_phone" placeholder="e.g. +91 98xxxxxx" type="tel" />
              </label>
            </div>

            <label className="stack">
              <span>Expected Delivery Date</span>
              <input
                type="date"
                name="expected_delivery_date"
                defaultValue={tomorrowIso}
                style={{ fontFamily: "inherit" }}
              />
            </label>

            <label className="stack">
              <span>Notes (optional)</span>
              <textarea
                name="notes"
                rows={2}
                placeholder="e.g. Deliver to site foreman Ramesh · handle pink slabs with care"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            {/* Slab summary — read-only */}
            <details>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--muted)",
                  padding: "4px 0",
                  userSelect: "none",
                }}
              >
                ▸ Show {selectedSlabs.length} slab{selectedSlabs.length !== 1 ? "s" : ""} being dispatched
              </summary>
              <div
                style={{
                  marginTop: 6,
                  maxHeight: 180,
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 8,
                  background: "var(--bg)",
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {selectedSlabs.map((s) => (
                  <div key={s.id} style={{ padding: "3px 0", borderBottom: "1px dashed var(--border)" }}>
                    <strong>{s.id}</strong>
                    {s.label && <span style={{ color: "var(--muted)" }}> · {s.label}</span>}
                    {" · "}
                    {s.dimensions}
                    <span style={{ color: "var(--muted)" }}> · {s.cft.toFixed(2)} CFT</span>
                  </div>
                ))}
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                className="primary-button"
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? "Creating dispatch…" : `🚚 Dispatch ${selectedSlabs.length} slab${selectedSlabs.length !== 1 ? "s" : ""}`}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
