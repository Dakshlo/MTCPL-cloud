"use client";

/**
 * Send a bulk challan back to the Challans page — with OUR OWN confirm dialog
 * (not window.confirm) and the branded spinning-logo overlay while it runs
 * (Daksh).
 */

import { useState, useTransition } from "react";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { sendChallanBackFromBulkAction } from "../actions";

export function BulkSendBack({ id, code }: { id: string; code?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function doSend() {
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await sendChallanBackFromBulkAction(fd); // redirects to /invoicing/challans
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Sending back…" />
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
      >
        ↩ Send back
      </button>

      {confirming && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { if (!pending) setConfirming(false); }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>↩</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Send back to Challans?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
              {code ? <><strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{code}</strong> will</> : "This challan will"} leave the Bulk pool and reappear on the <strong>Challans</strong> page, where it can be converted to a single invoice or sent to bulk again.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} style={{ fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: pending ? "default" : "pointer", opacity: pending ? 0.5 : 1 }}>Cancel</button>
              <button type="button" disabled={pending} onClick={doSend} style={{ fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}>
                {pending ? "Sending…" : "↩ Send back"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
