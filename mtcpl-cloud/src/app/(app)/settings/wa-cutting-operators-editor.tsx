"use client";

// Per-operator phones for the cutting-approved WhatsApp. Each operator gets a
// message ONLY for the blocks they cut; the master list above gets every block.
// Owner / developer only.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCuttingOperatorPhonesAction } from "./wa-cutting-actions";

export function WaCuttingOperatorsEditor({
  operators,
  initial,
}: {
  operators: { id: string; name: string }[];
  initial: Record<string, string>;
}) {
  const router = useRouter();
  const [phones, setPhones] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function setPhone(id: string, raw: string) {
    setMsg(null);
    setErr(null);
    setPhones((p) => ({ ...p, [id]: raw.replace(/\D/g, "").slice(0, 12) }));
  }

  async function save() {
    // Validate non-empty entries before saving.
    for (const [, v] of Object.entries(phones)) {
      const d = (v ?? "").replace(/\D/g, "");
      if (d.length > 0 && (d.length < 10 || d.length > 12)) {
        setErr("One of the numbers isn't a valid 10-digit mobile.");
        return;
      }
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // Drop blanks so the saved map stays tidy.
      const clean: Record<string, string> = {};
      for (const [id, v] of Object.entries(phones)) {
        const d = (v ?? "").replace(/\D/g, "");
        if (d.length >= 10) clean[id] = d;
      }
      const res = await updateCuttingOperatorPhonesAction(clean);
      if (!res.ok) { setErr(res.error); return; }
      setPhones(res.phones);
      setMsg("✓ Saved");
      router.refresh();
    } catch {
      setErr("Failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Give each cutter operator their mobile number and they&apos;ll get a WhatsApp for <strong>their own blocks only</strong> (the master number above still gets every block). Leave blank to not message an operator.
      </p>

      {operators.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          No operators yet. Add them from the Cutting page (assign an operator to a block).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {operators.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 130px", fontSize: 13.5, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
              <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>+91</span>
              <input
                value={phones[o.id] ?? ""}
                onChange={(e) => setPhone(o.id, e.target.value)}
                inputMode="numeric"
                maxLength={12}
                placeholder="10-digit mobile (optional)"
                style={{ flex: "1 1 170px", padding: "8px 11px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", fontFamily: "ui-monospace, monospace" }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={busy || operators.length === 0} className="primary-button" style={{ padding: "9px 18px", opacity: busy || operators.length === 0 ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Save operator phones"}
        </button>
        {msg && <span style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{msg}</span>}
        {err && <span style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</span>}
      </div>
    </div>
  );
}
