"use client";

/** Mig 200 — discount on the FINAL amount (grand total incl. GST), shared by
 *  all four invoice forms. Default OFF; choose a flat ₹ amount or a % of the
 *  total. The form keeps the state + hidden inputs; this is just the picker. */

export type DiscountModeUi = "off" | "amount" | "percent";

export function DiscountControl({ mode, value, onMode, onValue }: {
  mode: DiscountModeUi;
  value: string;
  onMode: (m: DiscountModeUi) => void;
  onValue: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>Discount <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· on the final amount (after GST)</span></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {([["off", "Off"], ["amount", "₹ Amount"], ["percent", "% Percent"]] as const).map(([val, label]) => {
          const on = mode === val;
          return (
            <button
              key={val}
              type="button"
              onClick={() => onMode(val)}
              style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? (val === "off" ? "var(--border)" : "#b45309") : "var(--border)"}`, background: on ? (val === "off" ? "var(--surface)" : "rgba(180,83,9,0.12)") : "var(--bg)", color: on ? (val === "off" ? "var(--text)" : "#b45309") : "var(--text)" }}
            >
              {label}
            </button>
          );
        })}
        {mode !== "off" && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: "#b45309" }}>
            {mode === "amount" ? "₹" : "%"}
            <input
              value={value}
              onChange={(e) => onValue(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder={mode === "amount" ? "e.g. 500" : "e.g. 5"}
              style={{ width: 110, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "6px 9px", borderRadius: 8, border: "1.5px solid #b45309", background: "var(--bg)", color: "var(--text)" }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
