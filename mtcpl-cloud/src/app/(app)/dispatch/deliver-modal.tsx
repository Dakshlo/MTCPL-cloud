"use client";

/**
 * Modal for marking an out-for-delivery dispatch as delivered. The
 * site engineer phones in to confirm receipt — the developer fills
 * in the receiver name + optional note and submits.
 */

import { useState } from "react";
import { markDeliveredAction } from "./actions";

export function DeliverModal({
  dispatchId,
  temple,
  vehicleNo,
  onClose,
}: {
  dispatchId: string;
  temple: string;
  vehicleNo: string | null;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <>
      <div className="drawer-backdrop" onClick={submitting ? undefined : onClose} />
      <div
        className="edit-drawer"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-label="Mark Delivered"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">✓ Mark as Delivered</div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              🏛 {temple}
              {vehicleNo ? ` · Vehicle ${vehicleNo}` : ""}
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
              return markDeliveredAction(fd);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <input type="hidden" name="dispatch_id" value={dispatchId} />

            <div
              style={{
                background: "rgba(22,101,52,0.06)",
                border: "1px solid rgba(22,101,52,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              Confirm the site engineer reported successful delivery. The slabs remain in{" "}
              <code>dispatched</code> status — this only closes the dispatch batch.
            </div>

            <label className="stack">
              <span>Receiver Name (optional)</span>
              <input
                name="receiver_name"
                placeholder="e.g. Rajesh (Aasta Temple site engineer)"
              />
            </label>

            <label className="stack">
              <span>Delivery Note (optional)</span>
              <textarea
                name="delivery_note"
                rows={3}
                placeholder="e.g. Delivered 22 Apr ~3pm · all 4 slabs intact · no damage"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                className="primary-button"
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? "Saving…" : "✓ Mark as Delivered"}
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
