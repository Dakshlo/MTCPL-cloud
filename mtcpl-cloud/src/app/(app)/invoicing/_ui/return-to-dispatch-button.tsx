"use client";

/**
 * Mig 167 — Accountant "Cancel → return to dispatch" for a challan.
 *
 * Deletes the challan and sends its dispatch back to Waiting approval (flagged
 * Returned, with the reason). The dispatch KEEPS its CH number until it's fully
 * cancelled from the dispatch board (Daksh Jul 2026), so re-verifying reuses the
 * same number.
 *
 * Jul 2026 — replaced window.prompt/alert (which glitched against the review
 * page's full-screen split) with a proper in-app modal portalled to <body> so an
 * ancestor transform can't reposition it.
 */

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BUTTON_STYLES } from "../../accounts/_ui/components";

type ActionResult = { ok: true } | { ok: false; error: string };

export function ReturnToDispatchButton({
  challanId,
  action,
  label = "Cancel (return to dispatch)",
}: {
  challanId: string;
  action: (formData: FormData) => Promise<ActionResult>;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) { setError("A cancellation reason is required."); return; }
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("challan_id", challanId);
      fd.set("reason", trimmed);
      const r = await action(fd);
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      router.push(`/invoicing/challans?toast=${encodeURIComponent("Returned to dispatch — back in Waiting approval")}`);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => { setError(null); setReason(""); setOpen(true); }} disabled={pending} style={BUTTON_STYLES.danger}>
        {label}
      </button>
      {mounted && open && createPortal(
        <div onMouseDown={() => { if (!pending) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 20 }}>
          <FinanceLoadingOverlay show={pending} label="Returning to dispatch…" />
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>↩</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Send this challan back to dispatch?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 12px" }}>
              The dispatch returns to <strong>Waiting approval</strong> flagged <strong>Returned</strong>. It <strong>keeps the same CH number</strong> for a re-verify. A reason is required.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Why is it going back? (e.g. wrong slab, price mismatch…)"
              style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 13.5, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            {error && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" disabled={pending} onClick={() => setOpen(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Keep it</button>
              <button type="button" disabled={pending} onClick={submit} style={{ fontSize: 13, fontWeight: 800, padding: "9px 17px", borderRadius: 10, border: "none", color: "#fff", background: "#b91c1c", cursor: "pointer", opacity: pending ? 0.7 : 1 }}>
                {pending ? "Returning…" : "↩ Return to dispatch"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
