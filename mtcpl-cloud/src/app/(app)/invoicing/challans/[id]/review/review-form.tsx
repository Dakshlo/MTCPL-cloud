"use client";

/**
 * Invoicing review grid (Mig 157). Every slab attribute is locked; the team
 * fills a Rate per row and picks GST (none / IGST / CGST+SGST, manual %). Live
 * totals; Save (optionally → print landscape tax invoice). Blanks show "-".
 */

import { useMemo, useState } from "react";
import { saveChallanPricingAction } from "../../../actions";
import { dash } from "@/lib/dispatch-grouping";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";

export type PriceItem = {
  id: string;
  codes: string;
  label: string | null;
  description: string | null;
  additional_description: string | null;
  component_section: string | null;
  component_element: string | null;
  length_ft: number | null;
  width_ft: number | null;
  thickness_ft: number | null;
  qty: number;
  weightTonnes: number;
  unit: "cft" | "sft";
  measureQty: number;
  rate: number;
};

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function ReviewForm({
  challanId,
  items,
  initGst,
}: {
  challanId: string;
  items: PriceItem[];
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
}) {
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of items) m[it.id] = it.rate ? String(it.rate) : "";
    return m;
  });
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [igst, setIgst] = useState(String(initGst.igst));
  const [cgst, setCgst] = useState(String(initGst.cgst));
  const [sgst, setSgst] = useState(String(initGst.sgst));

  const amountOf = (it: PriceItem) => (Number(rates[it.id]) || 0) * it.measureQty;
  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        items.map((it) => amountOf(it)),
        { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, mode, igst, cgst, sgst, items],
  );
  const ratesJson = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.id] = Number(rates[it.id]) || 0;
    return JSON.stringify(m);
  }, [rates, items]);

  // Full cell borders → Excel-style grid (column lines + row lines).
  const cell: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" };
  const head: React.CSSProperties = { padding: "7px 9px", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", border: "1px solid var(--border)", borderBottomWidth: 2, whiteSpace: "nowrap", background: "var(--surface)" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  const cftItems = items.filter((it) => it.unit !== "sft");
  const sftItems = items.filter((it) => it.unit === "sft");

  const ItemRow = (it: PriceItem) => (
    <tr key={it.id}>
      <td style={{ ...cell, fontFamily: "ui-monospace, monospace", fontWeight: 700, maxWidth: 170 }}>{dash(it.codes)}</td>
      <td style={cell}>{dash(it.label)}</td>
      <td style={{ ...cell, maxWidth: 210 }}>{dash(it.description)}</td>
      <td style={{ ...cell, maxWidth: 190 }}>{dash(it.additional_description)}</td>
      <td style={cell}>{dash(it.component_section)}</td>
      <td style={cell}>{dash(it.component_element)}</td>
      <td style={numCell}>{it.length_ft ?? "-"}</td>
      <td style={numCell}>{it.width_ft ?? "-"}</td>
      <td style={numCell}>{it.thickness_ft ?? "-"}</td>
      <td style={{ ...numCell, fontWeight: 800 }}>{it.qty}</td>
      <td style={numCell}>{fmt(it.measureQty)}</td>
      <td style={{ ...cell, textAlign: "right" }}>
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={rates[it.id] ?? ""}
          onChange={(e) => setRates((p) => ({ ...p, [it.id]: e.target.value }))}
          placeholder="0"
          style={{ width: 90, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: "5px 7px", borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
        />
      </td>
      <td style={{ ...numCell, fontWeight: 800 }}>{rupee(amountOf(it))}</td>
    </tr>
  );

  function Section({ rows, unit }: { rows: PriceItem[]; unit: "cft" | "sft" }) {
    if (rows.length === 0) return null;
    const sub = rows.reduce((a, it) => a + amountOf(it), 0);
    const meas = rows.reduce((a, it) => a + it.measureQty, 0);
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "9px 14px", background: unit === "cft" ? "rgba(37,99,235,0.08)" : "rgba(217,119,6,0.1)", borderBottom: "1px solid var(--border)", fontWeight: 800, fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{unit === "cft" ? "📦 CFT (volume)" : "🟧 SFT (area)"} · {rows.length} row{rows.length !== 1 ? "s" : ""} · {fmt(meas)} {unit}</span>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>Subtotal {rupee(sub)}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr>
                {["Code(s)", "Label", "Description", "Additional", "Cat 1", "Cat 2"].map((c) => (
                  <th key={c} style={head}>{c}</th>
                ))}
                {["L", "W", "H", "Qty", unit.toUpperCase()].map((c) => (
                  <th key={c} style={{ ...head, textAlign: "right" }}>{c}</th>
                ))}
                <th style={{ ...head, textAlign: "right" }}>Rate ₹/{unit}</th>
                <th style={{ ...head, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>{rows.map(ItemRow)}</tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <form action={saveChallanPricingAction}>
      <input type="hidden" name="challan_id" value={challanId} />
      <input type="hidden" name="rates" value={ratesJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="igst_percent" value={igst} />
      <input type="hidden" name="cgst_percent" value={cgst} />
      <input type="hidden" name="sgst_percent" value={sgst} />

      {/* Called inline (not <Section/>) so editing a Rate input doesn't remount
          the table and drop focus after one keystroke. */}
      {Section({ rows: cftItems, unit: "cft" })}
      {Section({ rows: sftItems, unit: "sft" })}
      {items.length === 0 && (
        <div className="muted" style={{ textAlign: "center", padding: "24px 10px", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 12, marginBottom: 16 }}>No items on this challan.</div>
      )}

      {/* GST + totals */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 18 }}>
        <div style={{ flex: "1 1 320px", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 10 }}>GST</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {([["none", "No GST"], ["igst", "IGST"], ["cgst_sgst", "CGST + SGST"]] as const).map(([val, label]) => {
              const active = (val === "none" ? null : val) === mode;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setMode(val === "none" ? null : val)}
                  style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: active ? "1.5px solid #0f172a" : "1.5px solid var(--border)", background: active ? "#0f172a" : "var(--bg)", color: active ? "#fff" : "var(--text)" }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {mode === "igst" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              IGST %
              <input type="number" min={0} step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} style={pctInput} />
            </label>
          )}
          {mode === "cgst_sgst" && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                CGST %
                <input type="number" min={0} step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} style={pctInput} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                SGST %
                <input type="number" min={0} step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} style={pctInput} />
              </label>
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)" }}>
          <Row label="Subtotal" value={rupee(totals.subtotal)} />
          {mode === "igst" && <Row label={`IGST @ ${igst || 0}%`} value={rupee(totals.igstAmt)} />}
          {mode === "cgst_sgst" && (
            <>
              <Row label={`CGST @ ${cgst || 0}%`} value={rupee(totals.cgstAmt)} />
              <Row label={`SGST @ ${sgst || 0}%`} value={rupee(totals.sgstAmt)} />
            </>
          )}
          <div style={{ borderTop: "1.5px solid var(--border)", margin: "8px 0" }} />
          <Row label="Grand total" value={rupee(totals.grand)} big />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" name="go" value="print" style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 11, cursor: "pointer" }}>
          💾 Save &amp; print tax invoice →
        </button>
        <button type="submit" name="go" value="save" style={{ fontSize: 13.5, padding: "12px 20px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 11, cursor: "pointer" }}>
          Save only
        </button>
      </div>
    </form>
  );
}

const pctInput: React.CSSProperties = {
  width: 80,
  textAlign: "right",
  fontFamily: "ui-monospace, monospace",
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 7,
  border: "1.5px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
};

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "3px 0" }}>
      <span style={{ fontSize: big ? 15 : 13, fontWeight: big ? 800 : 600, color: big ? "var(--text)" : "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: big ? 18 : 13.5, fontWeight: big ? 800 : 700, fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}
