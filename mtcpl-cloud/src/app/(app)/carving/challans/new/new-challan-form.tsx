"use client";

import { useMemo, useState } from "react";
import { generateCarvingChallanAction } from "../../actions";

export type BillableSlab = {
  carvingItemId: string;
  vendorId: string;
  vendorName: string;
  slabId: string;
  label: string | null;
  temple: string;
  dims: string;
  cft: number;
  sft: number;
  snapRate: number | null;
  snapUnit: "cft" | "sft" | null;
};

function inr(n: number): string {
  return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function NewCarvingChallanForm({ billable }: { billable: BillableSlab[] }) {
  const vendors = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const b of billable) {
      const e = m.get(b.vendorId) ?? { id: b.vendorId, name: b.vendorName, count: 0 };
      e.count += 1;
      m.set(b.vendorId, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [billable]);

  const [vendorId, setVendorId] = useState<string>(vendors[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rate, setRate] = useState<string>("");
  const [unit, setUnit] = useState<"cft" | "sft">("cft");
  const [gstPct, setGstPct] = useState<string>("");
  const [isRcm, setIsRcm] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");

  const vendorSlabs = billable.filter((b) => b.vendorId === vendorId);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        // Pre-fill rate/unit from the first slab's snapshot, if any + empty.
        const slab = billable.find((b) => b.carvingItemId === id);
        if (slab?.snapRate != null && !rate) setRate(String(slab.snapRate));
        if (slab?.snapUnit) setUnit(slab.snapUnit);
      }
      return next;
    });
  }

  const rateNum = Number(rate) || 0;
  const gstNum = Number(gstPct) || 0;
  const chosen = vendorSlabs.filter((b) => selected.has(b.carvingItemId));
  const subtotal = chosen.reduce((s, b) => s + (unit === "sft" ? b.sft : b.cft) * rateNum, 0);
  const gstAmount = gstNum > 0 ? (subtotal * gstNum) / 100 : 0;
  const total = subtotal + (isRcm ? 0 : gstAmount);

  const canSubmit = vendorId && chosen.length > 0 && rateNum > 0;

  return (
    <form
      action={generateCarvingChallanAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input
        type="hidden"
        name="carving_item_ids"
        value={JSON.stringify([...selected].filter((id) => chosen.some((c) => c.carvingItemId === id)))}
      />
      <input type="hidden" name="rate" value={rate} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="gst_pct" value={gstPct} />
      <input type="hidden" name="is_rcm" value={isRcm ? "true" : "false"} />
      <input type="hidden" name="notes" value={notes} />

      {vendors.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, color: "var(--muted)" }}>
          No approved Outsource slabs waiting to be billed. Approve some outsource jobs first.
        </div>
      ) : (
        <>
          {/* Vendor picker */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Vendor</span>
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setSelected(new Set());
              }}
              style={{ padding: "8px 12px", fontSize: 14, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v.count} ready)</option>
              ))}
            </select>
          </label>

          {/* Slab checkboxes */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              <span>Slabs to bill ({chosen.length} selected)</span>
              <button
                type="button"
                onClick={() => setSelected(new Set(vendorSlabs.map((b) => b.carvingItemId)))}
                style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}
              >
                Select all
              </button>
            </div>
            {vendorSlabs.map((b) => {
              const checked = selected.has(b.carvingItemId);
              const qty = unit === "sft" ? b.sft : b.cft;
              return (
                <label key={b.carvingItemId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--border)", cursor: "pointer", background: checked ? "rgba(146,64,14,0.05)" : "transparent" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(b.carvingItemId)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.slabId}</span>
                      {b.label ? ` · ${b.label}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.temple} · {b.dims} · {b.cft} cft / {b.sft} sft</div>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>
                    {rateNum > 0 ? inr(qty * rateNum) : `${qty} ${unit}`}
                  </div>
                </label>
              );
            })}
          </div>

          {/* Rate + unit + GST */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Rate (₹ per unit)</span>
              <input type="number" min="0" step="1" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1200" style={{ padding: "8px 12px", fontSize: 14, fontWeight: 700, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              {(["cft", "sft"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", border: `1.5px solid ${unit === u ? "#92400e" : "var(--border)"}`, background: unit === u ? "rgba(146,64,14,0.08)" : "var(--surface)", color: unit === u ? "#92400e" : "var(--muted)", borderRadius: 8, cursor: "pointer" }}>/{u}</button>
              ))}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 120px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>GST %</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" value={gstPct} onChange={(e) => setGstPct(e.target.value)} placeholder="e.g. 18" style={{ padding: "8px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, paddingBottom: 8 }}>
              <input type="checkbox" checked={isRcm} onChange={(e) => setIsRcm(e.target.checked)} />
              RCM (reverse charge)
            </label>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes (optional)</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
          </label>

          {/* Totals + submit */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Subtotal {inr(subtotal)}</span>
              {gstNum > 0 && <span style={{ color: "var(--muted)" }}>{" · "}GST{isRcm ? " (RCM)" : ""} {inr(gstAmount)}</span>}
              <span style={{ fontWeight: 800, marginLeft: 8 }}>Total {inr(total)}</span>
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{ padding: "10px 22px", fontSize: 14, fontWeight: 800, color: "#fff", background: canSubmit ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: canSubmit ? "pointer" : "not-allowed" }}
            >
              🧾 Generate challan
            </button>
          </div>
        </>
      )}
    </form>
  );
}
