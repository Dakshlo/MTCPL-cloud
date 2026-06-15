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
  // Mig 100 — each slab is billed by its OWN unit: cft / sft / job (flat).
  snapUnit: "cft" | "sft" | "job" | null;
};

function inr(n: number): string {
  return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function unitLabel(u: BillableSlab["snapUnit"]): string {
  return u === "job" ? "job (flat)" : u === "sft" ? "/sft" : "/cft";
}
/** Amount for one slab at the given rate, by its own unit. */
function slabAmount(b: BillableSlab, rate: number): number {
  if (b.snapUnit === "job") return rate; // flat per slab
  const qty = b.snapUnit === "sft" ? b.sft : b.cft;
  return qty * rate;
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
  // Per-slab rate (pre-filled from the owner-approved snapshot, editable).
  const [rates, setRates] = useState<Record<string, string>>({});
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
        const slab = billable.find((b) => b.carvingItemId === id);
        if (slab?.snapRate != null) {
          setRates((r) => (r[id] != null ? r : { ...r, [id]: String(slab.snapRate) }));
        }
      }
      return next;
    });
  }
  function rateFor(b: BillableSlab): number {
    const raw = rates[b.carvingItemId];
    if (raw != null && raw !== "") return Number(raw) || 0;
    return b.snapRate ?? 0;
  }
  function setRate(id: string, v: string) {
    setRates((r) => ({ ...r, [id]: v }));
  }

  const chosen = vendorSlabs.filter((b) => selected.has(b.carvingItemId));
  const subtotal = chosen.reduce((s, b) => s + slabAmount(b, rateFor(b)), 0);
  const gstNum = Number(gstPct) || 0;
  const gstAmount = gstNum > 0 ? (subtotal * gstNum) / 100 : 0;
  const total = subtotal + (isRcm ? 0 : gstAmount);

  const allHaveRate = chosen.every((b) => rateFor(b) > 0);
  const canSubmit = !!vendorId && chosen.length > 0 && allHaveRate;

  const idsJson = JSON.stringify(chosen.map((b) => b.carvingItemId));
  const ratesJson = JSON.stringify(Object.fromEntries(chosen.map((b) => [b.carvingItemId, rateFor(b)])));

  return (
    <form action={generateCarvingChallanAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="carving_item_ids" value={idsJson} />
      <input type="hidden" name="rates_json" value={ratesJson} />
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

          {/* Slab rows — each billed by its OWN unit + rate (cft / sft / job). */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              <span>Slabs to bill ({chosen.length} selected) — each by its own unit &amp; rate</span>
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set(vendorSlabs.map((b) => b.carvingItemId)));
                  setRates((r) => {
                    const next = { ...r };
                    for (const b of vendorSlabs) if (next[b.carvingItemId] == null && b.snapRate != null) next[b.carvingItemId] = String(b.snapRate);
                    return next;
                  });
                }}
                style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}
              >
                Select all
              </button>
            </div>
            {vendorSlabs.map((b) => {
              const checked = selected.has(b.carvingItemId);
              const r = rateFor(b);
              const amount = slabAmount(b, r);
              return (
                <div key={b.carvingItemId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--border)", background: checked ? "rgba(146,64,14,0.05)" : "transparent", flexWrap: "wrap" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(b.carvingItemId)} />
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.slabId}</span>
                      {b.label ? ` · ${b.label}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {b.temple} · {b.dims} · {b.snapUnit === "sft" ? `${b.sft} sft` : `${b.cft} cft`}
                    </div>
                  </div>
                  {/* Unit chip (from the work order — not editable here) */}
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(146,64,14,0.1)", color: "#92400e", whiteSpace: "nowrap" }}>
                    {unitLabel(b.snapUnit)}
                  </span>
                  {/* Per-slab rate */}
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={rates[b.carvingItemId] ?? (b.snapRate != null ? String(b.snapRate) : "")}
                    onChange={(e) => setRate(b.carvingItemId, e.target.value)}
                    placeholder={b.snapUnit === "job" ? "₹/slab" : "₹/unit"}
                    disabled={!checked}
                    style={{ width: 90, fontSize: 12, padding: "6px 8px", border: `1px solid ${checked && !(r > 0) ? "#dc2626" : "var(--border)"}`, borderRadius: 6, background: checked ? "var(--bg)" : "var(--surface-alt)", color: "var(--text)" }}
                  />
                  <div style={{ width: 96, textAlign: "right", fontSize: 12, fontFamily: "ui-monospace, monospace", color: checked ? "var(--text)" : "var(--muted-light)", fontWeight: checked ? 700 : 400 }}>
                    {checked && r > 0 ? inr(amount) : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* GST + RCM + notes */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 120px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>GST %</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" value={gstPct} onChange={(e) => setGstPct(e.target.value)} placeholder="e.g. 18" style={{ padding: "8px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, paddingBottom: 8 }}>
              <input type="checkbox" checked={isRcm} onChange={(e) => setIsRcm(e.target.checked)} />
              RCM (reverse charge)
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes (optional)</span>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }} />
            </label>
          </div>

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
              title={!allHaveRate && chosen.length > 0 ? "Every selected slab needs a rate" : undefined}
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
