"use client";

// Add / remove the mobile numbers that receive the daily WhatsApp
// work-report (6 PM). Owner / developer only; persists immediately.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateWaReportRecipientsAction } from "./wa-recipients-actions";

export function WaRecipientsEditor({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Preview / send-test controls (moved here from the Dashboard).
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  async function sendTest() {
    if (sendBusy) return;
    if (numbers.length === 0) { setSendErr("Add at least one recipient first."); return; }
    if (!window.confirm(`Send the daily work-report PDF to ${numbers.length} number${numbers.length === 1 ? "" : "s"} now?`)) return;
    setSendBusy(true); setSendMsg(null); setSendErr(null);
    try {
      const res = await fetch("/api/whatsapp-report/run", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setSendErr(j.error || `HTTP ${res.status}`); return; }
      const t = j.totals ?? {};
      setSendMsg(`✓ Sent for ${j.label} to ${(j.recipients ?? []).join(", ")}. (Blocks ${t.blocks ?? 0} · Cutting ${t.cuttingSlabs ?? 0} · Carving ${t.carvingSlabs ?? 0} · Dispatch ${t.dispatchSlabs ?? 0})`);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSendBusy(false);
    }
  }

  async function persist(next: string[]) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("numbers", JSON.stringify(next));
      const res = await updateWaReportRecipientsAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      setNumbers(res.numbers);
      setMsg("✓ Saved");
      router.refresh();
    } catch {
      setErr("Failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const d = draft.replace(/\D/g, "");
    if (d.length < 10 || d.length > 12) { setErr("Enter a valid 10-digit mobile number."); return; }
    if (numbers.includes(d)) { setErr("That number is already in the list."); return; }
    setDraft("");
    void persist([...numbers, d]);
  }
  function remove(n: string) {
    if (busy) return;
    if (!window.confirm(`Stop sending the daily report to ${n}?`)) return;
    void persist(numbers.filter((x) => x !== n));
  }

  const chip: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        These numbers get the <strong>daily work-report PDF</strong> on WhatsApp every evening at 6 PM. Add or remove anyone here — changes apply to the next send.
      </p>

      {numbers.length === 0 ? (
        <div style={{ fontSize: 13, color: "#b45309", fontWeight: 700 }}>⚠ No recipients — the report won&apos;t be delivered to anyone.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {numbers.map((n) => (
            <div key={n} style={chip}>
              <span style={{ color: "var(--muted)", fontWeight: 600 }}>+91</span>
              <span style={{ flex: 1 }}>{n}</span>
              <button type="button" disabled={busy} onClick={() => remove(n)} style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", background: "none", border: "1px solid rgba(185,28,28,0.4)", borderRadius: 7, padding: "4px 10px", cursor: busy ? "wait" : "pointer" }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--muted)", fontSize: 14, fontWeight: 700 }}>+91</span>
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          inputMode="numeric"
          maxLength={12}
          placeholder="10-digit mobile number"
          style={{ flex: "1 1 200px", padding: "9px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", fontFamily: "ui-monospace, monospace" }}
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={add} className="primary-button" style={{ padding: "9px 18px", opacity: busy || !draft.trim() ? 0.6 : 1 }}>
          {busy ? "Saving…" : "+ Add number"}
        </button>
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}

      {/* Preview / send-test — moved here from the Dashboard. */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 2, display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          The report auto-sends every evening at <strong>6 PM</strong>. Preview the PDF with today&apos;s data (nothing is sent), or send a test now to the numbers above.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="/api/whatsapp-report/preview" target="_blank" rel="noopener noreferrer" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 800, color: "var(--gold-dark)", background: "var(--surface)", border: "1px solid var(--gold-dark)", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}>
            👁 Preview PDF
          </a>
          <button type="button" onClick={sendTest} disabled={sendBusy} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: sendBusy ? "var(--border)" : "#16A34A", border: "none", borderRadius: 8, cursor: sendBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
            {sendBusy ? "Sending…" : "Send test now"}
          </button>
        </div>
        {sendMsg && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 7, padding: "8px 12px" }}>{sendMsg}</div>}
        {sendErr && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 7, padding: "8px 12px" }}>⚠ {sendErr}</div>}
      </div>
    </div>
  );
}
