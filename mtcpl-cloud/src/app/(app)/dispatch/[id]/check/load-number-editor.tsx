"use client";

// Editable Load No. on Check & verify (Daksh). Saving rejects a number already
// used for this temple — the action returns a message suggesting the next free
// one in the current series.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateDispatchLoadNumberAction } from "../../actions";

export function LoadNumberEditor({ dispatchId, initial }: { dispatchId: string; initial: number | null }) {
  const router = useRouter();
  const [val, setVal] = useState(initial != null ? String(initial) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) { setErr("Enter a valid load number."); return; }
    setBusy(true); setErr(null); setOk(false);
    try {
      const res = await updateDispatchLoadNumberAction(dispatchId, n);
      if (res.ok) { setOk(true); router.refresh(); }
      else setErr(res.error);
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)" }}>Load no.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <input
          type="number"
          min={1}
          value={val}
          onChange={(e) => { setVal(e.target.value); setErr(null); setOk(false); }}
          style={{ width: 72, padding: "3px 6px", fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace", border: `1px solid ${err ? "#dc2626" : "var(--border)"}`, borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={save}
          style={{ fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 6, border: `1px solid ${ok ? "#15803d" : "var(--gold-dark)"}`, background: ok ? "#15803d" : "var(--gold)", color: "#fff", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}
        >
          {busy ? "…" : ok ? "✓ Saved" : "Save"}
        </button>
      </div>
      {err && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c", marginTop: 3, lineHeight: 1.35 }}>{err}</div>}
    </div>
  );
}
