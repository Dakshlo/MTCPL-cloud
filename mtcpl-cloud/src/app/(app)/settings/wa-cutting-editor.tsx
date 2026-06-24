"use client";

// Add / remove the mobile number(s) that get the cutting-approved WhatsApp
// (operator + block + slabs + codes + location, PDF attached). Owner / dev.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateWaCuttingRecipientsAction } from "./wa-cutting-actions";

export function WaCuttingEditor({ initial, configured }: { initial: string[]; configured: boolean }) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function persist(next: string[]) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await updateWaCuttingRecipientsAction(next);
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
    if (!window.confirm(`Stop sending the cutting-approved alert to ${n}?`)) return;
    void persist(numbers.filter((x) => x !== n));
  }

  const chip: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Master list — these numbers get a WhatsApp for <strong>every approved block</strong> (no matter the operator): cutter, block, slabs cut (codes + location), and a <strong>PDF</strong> of every slab&apos;s size, label, description &amp; category. Per-operator numbers are set below.
      </p>
      {!configured && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b45309", background: "rgba(180,83,9,0.1)", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 7, padding: "8px 12px" }}>
          ⚠ Dormant — set <code style={{ fontFamily: "ui-monospace, monospace" }}>MSG91_WA_CUTTING_TEMPLATE</code> (the approved template name) in Vercel + redeploy to start sending.
        </div>
      )}

      {numbers.length === 0 ? (
        <div style={{ fontSize: 13, color: "#b45309", fontWeight: 700 }}>⚠ No recipients — nobody will get the alert.</div>
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
