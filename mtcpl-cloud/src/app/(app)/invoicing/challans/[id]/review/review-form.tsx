"use client";

/**
 * Invoicing review grid (Mig 157). Rows are locked; the team prices each
 * STONE+UNIT table ONCE (one Rate ₹/cft|sft per table, applied to its whole
 * measure) — not per row (Daksh). GST (none / IGST / CGST+SGST). Optionally
 * override the invoice number during the migration off the old series. Live
 * totals; Save (optionally → print landscape tax invoice).
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
  stone: string;
};

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function ReviewForm({
  challanId,
  items,
  initGst,
  invPrefix,
  initNum,
  autoNum,
  transportCompanies = [],
  initTransport = { company: "", phone: "", lr: "", vehicle: "", driverName: "", driverPhone: "" },
}: {
  challanId: string;
  items: PriceItem[];
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  /** Fixed "INV-26/27-" prefix; the reviewer edits only the trailing number. */
  invPrefix: string;
  initNum: string;
  autoNum: string;
  transportCompanies?: string[];
  initTransport?: { company: string; phone: string; lr: string; vehicle: string; driverName: string; driverPhone: string };
}) {
  // One rate per stone+unit group (key = `${stone}|${unit}`).
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; stone: string; unit: "cft" | "sft"; items: PriceItem[] }>();
    for (const it of items) {
      const key = `${it.stone}|${it.unit}`;
      let g = m.get(key);
      if (!g) { g = { key, stone: it.stone, unit: it.unit, items: [] }; m.set(key, g); }
      g.items.push(it);
    }
    return [...m.values()].sort(
      (a, b) => a.stone.localeCompare(b.stone) || (a.unit === b.unit ? 0 : a.unit === "cft" ? -1 : 1),
    );
  }, [items]);

  const [rates, setRates] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const g of groups) {
      const r = g.items.find((it) => it.rate > 0)?.rate ?? 0; // pre-fill from existing per-item rate
      m[g.key] = r ? String(r) : "";
    }
    return m;
  });
  const [invNum, setInvNum] = useState(initNum);
  // Custom transport-company combobox (our own dropdown, not the browser datalist).
  const [company, setCompany] = useState(initTransport.company);
  const [companyOpen, setCompanyOpen] = useState(false);
  const companyMatches = useMemo(() => {
    const q = company.trim().toLowerCase();
    return (q ? transportCompanies.filter((n) => n.toLowerCase().includes(q)) : transportCompanies).slice(0, 50);
  }, [company, transportCompanies]);
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [igst, setIgst] = useState(String(initGst.igst));
  const [cgst, setCgst] = useState(String(initGst.cgst));
  const [sgst, setSgst] = useState(String(initGst.sgst));

  const rateOf = (it: PriceItem) => Number(rates[`${it.stone}|${it.unit}`]) || 0;
  const amountOf = (it: PriceItem) => rateOf(it) * it.measureQty;
  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        items.map((it) => amountOf(it)),
        { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, mode, igst, cgst, sgst, items],
  );
  // Expand the per-group rate to a per-item rate for the existing action.
  const ratesJson = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.id] = rateOf(it);
    return JSON.stringify(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates, items]);

  const cell: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" };
  const head: React.CSSProperties = { padding: "7px 9px", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", border: "1px solid var(--border)", borderBottomWidth: 2, whiteSpace: "nowrap", background: "var(--surface)" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace" };
  const tLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" };
  const tInput: React.CSSProperties = { fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" };

  const ItemRow = (it: PriceItem) => (
    <tr key={it.id}>
      <td style={{ ...cell, fontFamily: "ui-monospace, monospace", fontWeight: 700, maxWidth: 190 }}>{dash(it.codes)}</td>
      <td style={cell}>{dash(it.label)}</td>
      <td style={{ ...cell, maxWidth: 230 }}>{dash(it.description)}</td>
      {/* Category 2 before Category 1 (Daksh) */}
      <td style={cell}>{dash(it.component_element)}</td>
      <td style={cell}>{dash(it.component_section)}</td>
      <td style={numCell}>{it.length_ft ?? "-"}</td>
      <td style={numCell}>{it.width_ft ?? "-"}</td>
      <td style={numCell}>{it.thickness_ft ?? "-"}</td>
      <td style={{ ...numCell, fontWeight: 800 }}>{it.qty}</td>
      <td style={{ ...numCell, fontWeight: 800 }}>{fmt(it.measureQty)}</td>
    </tr>
  );

  function GroupSection(g: { key: string; stone: string; unit: "cft" | "sft"; items: PriceItem[] }) {
    const meas = g.items.reduce((a, it) => a + it.measureQty, 0);
    const sub = (Number(rates[g.key]) || 0) * meas;
    return (
      <div key={g.key} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "10px 14px", background: g.unit === "cft" ? "rgba(37,99,235,0.07)" : "rgba(217,119,6,0.09)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>
            {g.stone} · {g.unit.toUpperCase()} <span style={{ fontWeight: 600, color: "var(--muted)" }}>· {g.items.length} row{g.items.length !== 1 ? "s" : ""} · {fmt(meas)} {g.unit}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
              Rate ₹/{g.unit}
              <input
                type="text"
                inputMode="decimal"
                value={rates[g.key] ?? ""}
                onChange={(e) => setRates((p) => ({ ...p, [g.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                placeholder="0"
                style={{ width: 110, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "6px 9px", borderRadius: 8, border: "1.5px solid var(--gold-dark)", background: "var(--bg)", color: "var(--text)" }}
              />
            </label>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, minWidth: 110, textAlign: "right" }}>{rupee(sub)}</span>
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr>
                {["Code(s)", "Label", "Description", "Category 2", "Category 1"].map((c) => (
                  <th key={c} style={head}>{c}</th>
                ))}
                {["L", "W", "H", "Qty", g.unit.toUpperCase()].map((c) => (
                  <th key={c} style={{ ...head, textAlign: "right" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>{g.items.map(ItemRow)}</tbody>
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
      <input type="hidden" name="inv_seq" value={invNum} />

      {/* Called inline (not <GroupSection/>) so editing a Rate doesn't remount. */}
      {groups.map((g) => GroupSection(g))}
      {items.length === 0 && (
        <div className="muted" style={{ textAlign: "center", padding: "24px 10px", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 12, marginBottom: 16 }}>No items on this challan.</div>
      )}

      {/* Mig 169 — transportation details (printed on the tax invoice). The
          company is a datalist combobox: pick an existing one or type a new one
          (a new name is saved to the master on Save, for next time). */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 4 }}>🚚 Transportation</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>Vehicle no. &amp; driver are taken from the dispatch automatically.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div style={tLabel}>
            <span>Transport company</span>
            <div style={{ position: "relative" }}>
              <input
                name="transport_company"
                value={company}
                onChange={(e) => { setCompany(e.target.value); setCompanyOpen(true); }}
                onFocus={() => setCompanyOpen(true)}
                onBlur={() => setTimeout(() => setCompanyOpen(false), 120)}
                autoComplete="off"
                placeholder="Pick or type new…"
                style={{ ...tInput, width: "100%" }}
              />
              {companyOpen && companyMatches.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", maxHeight: 220, overflowY: "auto" }}>
                  {companyMatches.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setCompany(n); setCompanyOpen(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 13, background: n === company ? "rgba(184,115,51,0.12)" : "transparent", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text)" }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <label style={tLabel}><span>LR no.</span><input name="lr_no" defaultValue={initTransport.lr} style={tInput} /></label>
        </div>
      </div>

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
              <input type="text" inputMode="decimal" value={igst} onChange={(e) => setIgst(e.target.value.replace(/[^0-9.]/g, ""))} style={pctInput} />
            </label>
          )}
          {mode === "cgst_sgst" && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                CGST %
                <input type="text" inputMode="decimal" value={cgst} onChange={(e) => setCgst(e.target.value.replace(/[^0-9.]/g, ""))} style={pctInput} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                SGST %
                <input type="text" inputMode="decimal" value={sgst} onChange={(e) => setSgst(e.target.value.replace(/[^0-9.]/g, ""))} style={pctInput} />
              </label>
            </div>
          )}
          {/* Invoice number — fixed INV-<FY>- prefix, edit only the number. */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-light)" }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
            <div style={{ display: "inline-flex", alignItems: "stretch", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, background: "var(--surface)", color: "var(--muted)", borderRight: "1.5px solid var(--border)" }}>{invPrefix}</span>
              <input
                type="text"
                inputMode="numeric"
                value={invNum}
                onChange={(e) => setInvNum(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={autoNum}
                style={{ width: 90, textAlign: "left", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, padding: "6px 10px", border: "none", background: "transparent", color: "var(--text)" }}
              />
            </div>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 5 }}>Leave blank to auto-number as <strong style={{ fontFamily: "ui-monospace, monospace" }}>{invPrefix}{autoNum}</strong>. Editing the number continues the series after it.</span>
          </div>
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
        <button type="submit" name="go" value="save" style={{ fontSize: 14.5, padding: "12px 26px", fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 11, cursor: "pointer" }}>
          📤 Send for approval to owner →
        </button>
      </div>
    </form>
  );
}

const pctInput: React.CSSProperties = {
  width: 90,
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
