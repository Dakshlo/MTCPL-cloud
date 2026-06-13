"use client";

// Owner/dev test button for the daily WhatsApp work-report. POSTs to the
// send route (the same pipeline the 6 PM cron runs) so the owner can
// verify the PDF + delivery before/independently of the schedule.

import { useState } from "react";

export function WhatsAppReportTest() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (busy) return;
    if (!confirm("Send the daily work-report PDF to the configured WhatsApp numbers now?")) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch("/api/whatsapp-report/run", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `HTTP ${res.status}`); return; }
      setMsg(`✓ Sent for ${j.label} to ${(j.recipients ?? []).join(", ")}. (Cutting ${Number(j.totals?.cuttingCft ?? 0).toFixed(1)} CFT · Carving ${Number(j.totals?.carvingCft ?? 0).toFixed(1)} CFT · Dispatch ${j.totals?.dispatchSlabs ?? 0} slabs.)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>📲 Daily WhatsApp work-report</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Auto-sends a PDF (cutting by stone · carving by vendor · dispatch) every evening at 6 PM. Send a test now to verify.
          </div>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={busy}
          style={{ padding: "9px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: busy ? "var(--border)" : "#16A34A", border: "none", borderRadius: 8, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}
        >
          {busy ? "Sending…" : "Send test now"}
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.4)", color: "#15803d", fontSize: 12.5, fontWeight: 600, borderRadius: 7 }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", color: "#b91c1c", fontSize: 12.5, borderRadius: 7 }}>⚠ {err}</div>}
    </div>
  );
}
