"use client";

// Editable Challan No. on Check & verify (Mig 168). The FY prefix (CH-26/27-) is
// fixed; only the trailing N is editable so the code matches real operations.
// Saving rejects a number already used this FY and bumps the series so the next
// auto number continues from N+1. The invoicing challan + tax invoice mirror it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setChallanDocSeqAction } from "../../actions";

export function ChallanNumberEditor({ dispatchId, fy, seq }: { dispatchId: string; fy: string; seq: number | null }) {
  const router = useRouter();
  const [val, setVal] = useState(seq != null ? String(seq) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) { setErr("Enter a valid number."); return; }
    setBusy(true); setErr(null); setOk(false);
    try {
      const res = await setChallanDocSeqAction(dispatchId, n);
      if (res.ok) { setOk(true); router.refresh(); }
      else setErr(res.error);
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#D97706", fontSize: 15 }}>CH-{fy}-</span>
      <input
        type="number"
        min={1}
        value={val}
        onChange={(e) => { setVal(e.target.value); setErr(null); setOk(false); }}
        title="Edit the challan number (matches the invoice number)"
        style={{ width: 64, padding: "2px 6px", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", border: `1px solid ${err ? "#dc2626" : "var(--border)"}`, borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={save}
        style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 6, border: `1px solid ${ok ? "#15803d" : "var(--gold-dark)"}`, background: ok ? "#15803d" : "var(--gold)", color: "#fff", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}
      >
        {busy ? "…" : ok ? "✓" : "Save"}
      </button>
      {err && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c" }}>{err}</span>}
    </span>
  );
}
