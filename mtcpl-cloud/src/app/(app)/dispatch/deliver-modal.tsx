"use client";

/**
 * Mark-delivered modal — mig 129.
 *
 * Delivery can only be confirmed with PROOF: two mandatory photos —
 *   1. 🚛 the truck at the site (slabs reached), and
 *   2. 📝 the signed delivery challan.
 * The submit button stays locked until both are attached. Built for the
 * phone-in-hand flow: each photo box opens the camera / gallery and
 * shows a preview.
 */

import { useEffect, useRef, useState } from "react";
import { markDeliveredAction } from "./actions";

function PhotoBox({
  name, title, hint, onPicked,
}: {
  name: string;
  title: string;
  hint: string;
  onPicked: (has: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function onChange() {
    const f = inputRef.current?.files?.[0];
    if (preview) URL.revokeObjectURL(preview);
    if (f) {
      setPreview(URL.createObjectURL(f));
      onPicked(true);
    } else {
      setPreview(null);
      onPicked(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      style={{
        flex: "1 1 170px",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
        minHeight: 130, padding: 10, cursor: "pointer",
        background: preview ? "var(--surface)" : "rgba(184,115,51,0.05)",
        border: `2px dashed ${preview ? "#15803d" : "var(--gold-dark)"}`,
        borderRadius: 14, color: "var(--text)", position: "relative", overflow: "hidden",
      }}
    >
      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
          <span style={{ position: "relative", fontSize: 12.5, fontWeight: 800, color: "#fff", background: "rgba(21,128,61,0.9)", borderRadius: 999, padding: "4px 12px" }}>
            ✓ {title} — tap to change
          </span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 30 }}>📷</span>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>{title}</span>
          <span className="muted" style={{ fontSize: 11.5, textAlign: "center", lineHeight: 1.4 }}>{hint}</span>
        </>
      )}
      {/* Daksh (Jun 2026) — no `capture` attribute: that forced the camera
          only. Plain accept="image/*" lets the user EITHER take a photo OR
          upload one from the gallery/files (the native picker offers both). */}
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        onChange={onChange}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </button>
  );
}

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
  const [hasSite, setHasSite] = useState(false);
  const [hasChallan, setHasChallan] = useState(false);
  const ready = hasSite && hasChallan;

  return (
    <>
      <div className="drawer-backdrop" onClick={submitting ? undefined : onClose} />
      <div
        className="edit-drawer"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-label="Mark Delivered"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">📸 Mark as Delivered</div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
              🏛 {temple}
              {vehicleNo ? ` · Vehicle ${vehicleNo}` : ""}
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} disabled={submitting}>✕</button>
        </div>

        <div className="drawer-body">
          <form
            action={(fd) => {
              setSubmitting(true);
              return markDeliveredAction(fd);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <input type="hidden" name="dispatch_id" value={dispatchId} />

            <div
              style={{
                background: "rgba(180,83,9,0.06)", border: "1.5px solid rgba(180,83,9,0.35)",
                borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e", fontWeight: 700,
              }}
            >
              ⚠ Both photos are REQUIRED — delivery cannot be marked without proof.
              <span style={{ display: "block", fontWeight: 500, marginTop: 2 }}>
                दोनों photo ज़रूरी हैं — बिना photo delivery mark नहीं होगी।
              </span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <PhotoBox
                name="proof_site"
                title="1 · Truck at site"
                hint="Slabs reached — truck/unloading photo on site"
                onPicked={setHasSite}
              />
              <PhotoBox
                name="proof_challan"
                title="2 · Signed challan"
                hint="Photo of the challan signed by the receiver"
                onPicked={setHasChallan}
              />
            </div>

            <label className="stack">
              <span>Receiver Name (optional)</span>
              <input name="receiver_name" placeholder="Site engineer who received" />
            </label>

            <label className="stack">
              <span>Delivery Note (optional)</span>
              <textarea name="delivery_note" rows={2} style={{ resize: "vertical", fontFamily: "inherit" }} />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                disabled={submitting || !ready}
                style={{
                  flex: 1, padding: "13px 14px", fontSize: 15, fontWeight: 800, color: "#fff",
                  background: submitting || !ready ? "var(--border)" : "#16A34A",
                  border: "none", borderRadius: 10, cursor: submitting ? "wait" : ready ? "pointer" : "not-allowed",
                }}
              >
                {submitting
                  ? "Saving…"
                  : ready
                    ? "✓ Mark as Delivered"
                    : `Attach ${!hasSite && !hasChallan ? "both photos" : !hasSite ? "photo 1 (truck at site)" : "photo 2 (signed challan)"} first`}
              </button>
              <button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
