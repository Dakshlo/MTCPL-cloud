"use client";

// Send a SELECTED subset of the ready (cut-done, un-sent) slabs to the vendor.
// Tap chips to pick, then "Send selected" — defaults to all, with a confirm.
// (Per-card "Send to vendor" still handles single sends.)

import { useState, type CSSProperties } from "react";
import { sendSelectedWorkOrderLinesAction } from "../../actions";

export function ReadySendPanel({
  workOrderId, vendorName, ready,
}: {
  workOrderId: string;
  vendorName: string;
  ready: Array<{ lineId: string; code: string; dims: string }>;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(ready.map((r) => r.lineId)));
  const allOn = ready.length > 0 && sel.size === ready.length;

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const chip = (on: boolean): CSSProperties => ({
    fontSize: 11.5, fontWeight: 700, fontFamily: "ui-monospace, monospace",
    padding: "4px 9px", borderRadius: 999, cursor: "pointer",
    color: on ? "#fff" : "#7c2d12",
    background: on ? "#92400e" : "rgba(180,115,51,0.08)",
    border: `1px solid ${on ? "#92400e" : "rgba(180,115,51,0.35)"}`,
  });

  return (
    <form
      action={sendSelectedWorkOrderLinesAction}
      onSubmit={(e) => {
        if (sel.size === 0) { e.preventDefault(); return; }
        if (!confirm(`Send ${sel.size} slab${sel.size === 1 ? "" : "s"} to ${vendorName}? They are handed to the vendor for carving.`)) e.preventDefault();
      }}
      style={{ background: "rgba(146,64,14,0.06)", border: "1px solid rgba(146,64,14,0.3)", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <input type="hidden" name="line_ids" value={JSON.stringify([...sel])} readOnly />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#7c2d12" }}>
          {ready.length} ready slab{ready.length === 1 ? "" : "s"} for {vendorName} — tap to pick which to send.
        </div>
        <button type="button" onClick={() => setSel(allOn ? new Set() : new Set(ready.map((r) => r.lineId)))} style={{ fontSize: 12, fontWeight: 700, color: "#92400e", background: "var(--surface)", border: "1px solid rgba(146,64,14,0.35)", borderRadius: 8, padding: "5px 11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ready.map((r) => {
          const on = sel.has(r.lineId);
          return (
            <button type="button" key={r.lineId} onClick={() => toggle(r.lineId)} title={`${r.code} · ${r.dims}″`} style={chip(on)}>
              {on ? "✓ " : ""}{r.code}
            </button>
          );
        })}
      </div>

      <button type="submit" disabled={sel.size === 0} style={{ alignSelf: "flex-start", padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: sel.size === 0 ? "var(--border)" : "#92400e", border: "none", borderRadius: 8, cursor: sel.size === 0 ? "not-allowed" : "pointer" }}>
        📤 Send selected ({sel.size}) →
      </button>
    </form>
  );
}
