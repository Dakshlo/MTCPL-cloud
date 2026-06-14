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
    </div>
  );
}
