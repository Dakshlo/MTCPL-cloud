"use client";

/**
 * Invoicing review grid (Mig 157). Rows are locked; the team prices each
 * STONE+UNIT table ONCE (one Rate ₹/cft|sft per table, applied to its whole
 * measure) — not per row (Daksh). GST (none / IGST / CGST+SGST). Optionally
 * override the invoice number during the migration off the old series. Live
 * totals; Save (optionally → print landscape tax invoice).
 */

import { useMemo, useState } from "react";
import { saveChallanPricingAction, returnDispatchToWaitingAction } from "../../../actions";
import { ReturnToDispatchButton } from "../../../_ui/return-to-dispatch-button";
import { dash } from "@/lib/dispatch-grouping";
import { applyDiscount, computeGroupedGstTotals, discountLabel, gstGroupLabel, rupee, type DiscountMode, type GroupedInvoiceTotals, type GstMode } from "@/lib/challan-pricing";
import { DiscountControl, type DiscountModeUi } from "../../../_ui/discount-control";
import { amountInWordsIN } from "@/lib/amount-words";

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
  freedNumbers = [],
  editMode = false,
  bill = null,
  ship = null,
  challanCode = "",
  transportCompanies = [],
  initTransport = { company: "", phone: "", lr: "", vehicle: "", driverName: "", driverPhone: "" },
  initHsn = {},
  initHeads = {},
  initTableGst = {},
  initDiscount,
  hsnUseVendor = false,
}: {
  challanId: string;
  items: PriceItem[];
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  /** Fixed "INV-26/27-" prefix. The number is LOCKED (auto-assigned). */
  invPrefix: string;
  initNum: string;
  autoNum: string;
  /** Mig 178 — freed (gap) numbers from cancelled invoices, indication only. */
  freedNumbers?: number[];
  /** Jul 2026 — editing a FINAL (approved) invoice: number + approval kept. */
  editMode?: boolean;
  /** Bill-To / Ship-To blocks + source challan code for the invoice preview. */
  bill?: { name: string; address: string | null; gstin: string | null } | null;
  ship?: { name: string; address: string | null } | null;
  challanCode?: string;
  transportCompanies?: string[];
  initTransport?: { company: string; phone: string; lr: string; vehicle: string; driverName: string; driverPhone: string };
  /** Per-stone HSN pre-fill — mandatory to fill before sending (Daksh). */
  initHsn?: Record<string, string>;
  /** Mig 187 — per-stone custom table headings (prints LEFT of the stone band). */
  initHeads?: Record<string, string>;
  /** Mig 199 — per-stone-TABLE GST slab % ({ "<stone>|<unit>" → pct }). */
  initTableGst?: Record<string, number>;
  /** Mig 200 — the invoice's saved discount (mode null = off). */
  initDiscount?: { mode: "amount" | "percent" | null; value: number };
  hsnUseVendor?: boolean;
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
  // HSN per stone (Daksh) — one code per stone table, MANDATORY, pre-filled from
  // the stone master (edits save back to it on submit).
  const [hsn, setHsn] = useState<Record<string, string>>(() => ({ ...initHsn }));
  // Mig 187 — custom per-stone table heading (prints LEFT of the stone band on
  // the tax invoice). Typed in CAPS, keyed by stone (shared across its cft/sft
  // sub-tables). Optional — falls back to the stone name on the invoice.
  const [heads, setHeads] = useState<Record<string, string>>(() => ({ ...initHeads }));
  void hsnUseVendor;
  // Custom transport-company combobox (our own dropdown, not the browser datalist).
  const [company, setCompany] = useState(initTransport.company);
  const [companyOpen, setCompanyOpen] = useState(false);
  const companyMatches = useMemo(() => {
    const q = company.trim().toLowerCase();
    return (q ? transportCompanies.filter((n) => n.toLowerCase().includes(q)) : transportCompanies).slice(0, 50);
  }, [company, transportCompanies]);
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [showPreview, setShowPreview] = useState(false);
  // Mig 200 — discount on the final amount (default off; prefilled in edit).
  const [discMode, setDiscMode] = useState<DiscountModeUi>(initDiscount?.mode ?? "off");
  const [discValue, setDiscValue] = useState(initDiscount?.mode && initDiscount.value ? String(initDiscount.value) : "");
  // Mig 199 — GST slab PER STONE TABLE (key = `${stone}|${unit}`), mandatory.
  // Prefill: the invoice's stored per-table slab, else its legacy single %.
  const legacyPct = initGst.mode === "cgst_sgst" ? (Number(initGst.cgst) || 0) + (Number(initGst.sgst) || 0) : Number(initGst.igst) || 0;
  const [tableGst, setTableGst] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const g of groups) {
      const own = initTableGst[g.key];
      m[g.key] = own != null && Number.isFinite(Number(own)) ? String(own) : legacyPct ? String(legacyPct) : "18";
    }
    return m;
  });

  const rateOf = (it: PriceItem) => Number(rates[`${it.stone}|${it.unit}`]) || 0;
  const amountOf = (it: PriceItem) => rateOf(it) * it.measureQty;
  const gstOf = (key: string): number | null => ((tableGst[key] ?? "").trim() === "" ? null : Number(tableGst[key]) || 0);
  const totals = useMemo(
    () =>
      computeGroupedGstTotals(
        items.map((it) => ({ amount: amountOf(it), gstPercent: gstOf(`${it.stone}|${it.unit}`) })),
        { mode, igst: 0, cgst: 0, sgst: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, mode, tableGst, items],
  );
  // Rate is MANDATORY — every stone table needs a rate before sending/saving.
  const allRated = groups.length > 0 && groups.every((g) => Number(rates[g.key]) > 0);
  // Expand the per-group rate to a per-item rate for the existing action.
  const ratesJson = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.id] = rateOf(it);
    return JSON.stringify(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates, items]);
  // HSN is MANDATORY per stone table (Daksh).
  const allHsn = groups.length > 0 && groups.every((g) => (hsn[g.stone] ?? "").trim().length > 0);
  const hsnsJson = useMemo(() => JSON.stringify(hsn), [hsn]);
  // Custom heading (mig 187) is OPTIONAL — never blocks submit.
  const headsJson = useMemo(() => JSON.stringify(heads), [heads]);
  // GST slab is MANDATORY per table when GST is on (mig 199).
  const allGst = mode == null || groups.every((g) => (tableGst[g.key] ?? "").trim() !== "");
  const tableGstJson = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of groups) { const v = gstOf(g.key); if (v != null) m[g.key] = v; }
    return JSON.stringify(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableGst, groups]);
  // The same slab expanded PER ITEM (like ratesJson) — stored on challan_items
  // so every totals consumer reads all invoice types uniformly.
  const itemGstJson = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) { const v = gstOf(`${it.stone}|${it.unit}`); if (v != null) m[it.id] = v; }
    return JSON.stringify(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableGst, items]);
  const canSubmit = allRated && allHsn && allGst;
  const disc = applyDiscount(totals.grand, discMode === "off" ? null : discMode, Number(discValue) || 0);

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
        <div style={{ background: g.unit === "cft" ? "rgba(37,99,235,0.07)" : "rgba(217,119,6,0.09)", borderBottom: "1px solid var(--border)" }}>
          {/* Row 1 — mirrors the printed stone band: HEADING (left, CAPS) · HSN
              (centre, required) · STONE name (right). */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", padding: "10px 14px 7px" }}>
            <label style={{ flex: "1 1 220px", minWidth: 170, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Table heading · prints left</span>
              <input
                type="text"
                value={heads[g.stone] ?? ""}
                onChange={(e) => setHeads((p) => ({ ...p, [g.stone]: e.target.value.toUpperCase() }))}
                placeholder="TYPE A HEADING…"
                title="Custom heading for this stone table — prints on the LEFT of the invoice band"
                style={{ width: "100%", textTransform: "uppercase", fontWeight: 800, fontSize: 14, letterSpacing: "0.02em", padding: "7px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: (hsn[g.stone] ?? "").trim() ? "var(--muted)" : "#dc2626" }}>HSN · required</span>
              <input
                type="text"
                value={hsn[g.stone] ?? ""}
                onChange={(e) => setHsn((p) => ({ ...p, [g.stone]: e.target.value.replace(/[^0-9A-Za-z]/g, "") }))}
                placeholder="required"
                title="HSN code for this stone — prints in the centre of the invoice band"
                style={{ width: 122, textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 13.5, padding: "7px 9px", borderRadius: 8, border: `1.5px solid ${(hsn[g.stone] ?? "").trim() ? "var(--border)" : "#dc2626"}`, background: "var(--bg)", color: "var(--text)" }}
              />
            </label>
            <div style={{ textAlign: "right", minWidth: 110, paddingBottom: 2 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Stone</span>
              <span style={{ display: "block", fontWeight: 800, fontSize: 13.5 }}>{g.stone}</span>
            </div>
          </div>
          {/* Row 2 — pricing: unit + counts (left) · Rate + subtotal (right). */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0 14px 10px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              {g.unit.toUpperCase()} · {g.items.length} row{g.items.length !== 1 ? "s" : ""} · {fmt(meas)} {g.unit}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {mode && (
                <label title={`This table's GST slab — mandatory. ${mode === "cgst_sgst" ? "Splits half CGST / half SGST." : "Charged as IGST."}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: (tableGst[g.key] ?? "").trim() === "" ? "#dc2626" : "var(--text)" }}>
                  GST %
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tableGst[g.key] ?? ""}
                    onChange={(e) => setTableGst((p) => ({ ...p, [g.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                    placeholder="req."
                    style={{ width: 64, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "6px 8px", borderRadius: 8, border: `1.5px solid ${(tableGst[g.key] ?? "").trim() === "" ? "#dc2626" : "var(--gold-dark)"}`, background: "var(--bg)", color: "var(--text)" }}
                  />
                </label>
              )}
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
            <tfoot>
              <tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                <td colSpan={8} style={{ ...cell, textAlign: "right" }}>Total</td>
                <td style={{ ...numCell, fontWeight: 800 }}>{g.items.reduce((a, it) => a + it.qty, 0)}</td>
                <td style={{ ...numCell, fontWeight: 800 }}>{fmt(meas)} {g.unit}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <form action={saveChallanPricingAction}>
      <input type="hidden" name="challan_id" value={challanId} />
      <input type="hidden" name="edit_mode" value={editMode ? "1" : ""} />
      <input type="hidden" name="rates" value={ratesJson} />
      <input type="hidden" name="hsns" value={hsnsJson} />
      <input type="hidden" name="heads" value={headsJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="stone_gst" value={tableGstJson} />
      <input type="hidden" name="item_gst" value={itemGstJson} />
      <input type="hidden" name="discount_mode" value={discMode === "off" ? "" : discMode} />
      <input type="hidden" name="discount_value" value={discMode === "off" ? "" : discValue} />

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
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>Vehicle no. &amp; driver are prefilled from the dispatch — edit here if there&apos;s a mistake.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
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
          <label style={tLabel}><span>Vehicle no.</span><input name="transport_vehicle_no" defaultValue={initTransport.vehicle} style={{ ...tInput, fontFamily: "ui-monospace, monospace" }} /></label>
          <label style={tLabel}><span>Driver name</span><input name="transport_driver_name" defaultValue={initTransport.driverName} style={tInput} /></label>
          <label style={tLabel}><span>Driver phone</span><input name="transport_driver_phone" defaultValue={initTransport.driverPhone} style={tInput} /></label>
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
          {mode && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
              Each stone table has its own <strong>GST %</strong> box (next to its Rate) — mandatory. Tables can carry different slabs on one bill{mode === "cgst_sgst" ? "; a slab splits half CGST / half SGST" : ""}.
            </div>
          )}
          <DiscountControl mode={discMode} value={discValue} onMode={setDiscMode} onValue={setDiscValue} />
          {/* Invoice number — LOCKED (auto-assigned, never hand-edited). */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-light)" }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1.5px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "7px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5 }}>
              {invPrefix}{initNum ? initNum.padStart(2, "0") : autoNum}
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", fontFamily: "inherit" }}>🔒 {initNum ? "ASSIGNED" : "AUTO"}</span>
            </span>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
              {initNum ? "Number already assigned — it never changes." : "Assigned automatically on send — numbers can't be edited."}
            </span>
            {freedNumbers.length > 0 && (
              <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400e", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 8, padding: "6px 10px", marginTop: 8 }}>
                ℹ Free number{freedNumbers.length !== 1 ? "s" : ""} (from cancelled invoices): <strong style={{ fontFamily: "ui-monospace, monospace" }}>{freedNumbers.join(", ")}</strong> — the series still continues at {invPrefix}{autoNum}.
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)" }}>
          <Row label="Subtotal" value={rupee(totals.subtotal)} />
          {totals.groups.map((g, i) => (
            <Row key={i} label={`${gstGroupLabel(mode, g)}${totals.multi ? ` on ${rupee(g.taxable)}` : ""}`} value={rupee(g.taxAmt)} />
          ))}
          {disc.amt > 0 ? (
            <>
              <div style={{ borderTop: "1.5px solid var(--border)", margin: "8px 0" }} />
              <Row label="Grand total" value={rupee(totals.grand)} />
              <Row label={discountLabel(disc)} value={`−${rupee(disc.amt)}`} />
              <div style={{ borderTop: "1.5px solid var(--border)", margin: "8px 0" }} />
              <Row label="Amount payable" value={rupee(disc.payable)} big />
            </>
          ) : (
            <>
              <div style={{ borderTop: "1.5px solid var(--border)", margin: "8px 0" }} />
              <Row label="Grand total" value={rupee(totals.grand)} big />
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="submit" name="go" value="save" disabled={!canSubmit} title={canSubmit ? undefined : "Enter a rate + HSN + GST % for every stone table first"} style={{ fontSize: 14.5, padding: "12px 26px", fontWeight: 800, color: "#fff", background: canSubmit ? "#0f172a" : "var(--border)", border: "none", borderRadius: 11, cursor: canSubmit ? "pointer" : "not-allowed" }}>
          {editMode ? "💾 Save invoice changes →" : "📤 Send for approval to owner →"}
        </button>
        {/* Preview how the finished tax invoice will look (NOT VALID watermark). */}
        <button type="button" onClick={() => setShowPreview(true)} style={{ fontSize: 13.5, padding: "12px 20px", fontWeight: 800, color: "#0f2540", background: "var(--surface, #fff)", border: "1.5px solid #0f2540", borderRadius: 11, cursor: "pointer" }}>
          👁 Preview invoice
        </button>
        {/* Cancel = drop this challan and bounce the dispatch back to Waiting approval. */}
        {!editMode && <ReturnToDispatchButton challanId={challanId} action={returnDispatchToWaitingAction} label="✕ Cancel — send back to dispatch" />}
        {!canSubmit && <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>⚠ Rate + HSN{mode ? " + GST %" : ""} are required for every stone table.</span>}
      </div>

      {showPreview && (
        <InvoicePreview
          bill={bill}
          ship={ship}
          challanCode={challanCode}
          invoiceNo={`${invPrefix}${initNum ? initNum.padStart(2, "0") : autoNum}`}
          groups={groups.map((g) => ({ key: g.key, stone: g.stone, head: (heads[g.stone] ?? "").trim(), hsn: (hsn[g.stone] ?? "").trim(), unit: g.unit, meas: g.items.reduce((a, it) => a + it.measureQty, 0), qty: g.items.reduce((a, it) => a + it.qty, 0), rate: Number(rates[g.key]) || 0, gst: gstOf(g.key), items: g.items.map((it) => ({ codes: it.codes, label: it.label, description: it.description, section: it.component_section, element: it.component_element, l: it.length_ft, w: it.width_ft, h: it.thickness_ft, qty: it.qty, meas: it.measureQty })) }))}
          totals={totals}
          mode={mode}
          discountMode={discMode === "off" ? null : discMode}
          discountValue={Number(discValue) || 0}
          onClose={() => setShowPreview(false)}
        />
      )}
    </form>
  );
}

/** Full tax-invoice preview (NOT VALID watermark) — renders how the FINAL invoice
 *  will read once priced + owner-approved (Bill/Ship To, covered challan, GST, tax
 *  summary, amount in words, signatures). Daksh Jul 2026. */
function InvoicePreview({ bill, ship, challanCode, invoiceNo, groups, totals, mode, discountMode = null, discountValue = 0, onClose }: {
  bill: { name: string; address: string | null; gstin: string | null } | null;
  ship: { name: string; address: string | null } | null;
  challanCode: string;
  invoiceNo: string;
  groups: Array<{ key: string; stone: string; head: string; hsn: string; unit: "cft" | "sft"; meas: number; qty: number; rate: number; gst: number | null; items: Array<{ codes: string | null; label: string | null; description: string | null; section: string | null; element: string | null; l: number | null; w: number | null; h: number | null; qty: number; meas: number }> }>;
  totals: GroupedInvoiceTotals;
  mode: GstMode;
  discountMode?: DiscountMode;
  discountValue?: number;
  onClose: () => void;
}) {
  const pcell: React.CSSProperties = { padding: "4px 6px", border: "1px solid #e2e7ee", fontWeight: 700, color: "#1a1a1a", fontSize: 10.5 };
  const ph: React.CSSProperties = { ...pcell, background: "#eef2f7", fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", color: "#444" };
  const ptot: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 20, padding: "5px 12px", fontSize: 11.5 };
  const party: React.CSSProperties = { flex: 1, border: "1px solid #ccc", borderRadius: 6, padding: "7px 9px", background: "#f7fafc" };
  const kk: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#888" };
  const shipName = (ship?.name ?? "").trim() || bill?.name || "—";
  const disc = applyDiscount(totals.grand, discountMode, discountValue);
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "start center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(820px, 100%)", background: "#fff", color: "#1a1a1a", borderRadius: 12, padding: "18px 22px 22px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", alignContent: "space-evenly", justifyItems: "center", padding: "26px 0" }}>
          {Array.from({ length: 24 }).map((_, i) => <span key={i} style={{ transform: "rotate(-30deg)", whiteSpace: "nowrap", font: "800 15px/1 Arial, sans-serif", color: "#d40000", opacity: 0.16 }}>NOT VALID INVOICE</span>)}
        </div>
        <div style={{ position: "relative", zIndex: 10 }}>
          <div style={{ textAlign: "center", marginBottom: 7 }}><span style={{ display: "inline-block", fontSize: 15, fontWeight: 800, letterSpacing: "0.16em", color: "#fff", background: "#0f2540", borderRadius: 6, padding: "4px 22px" }}>TAX INVOICE</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "flex-start", gap: 12, borderBottom: "2.5px double #1e3a5f", paddingBottom: 6, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2540" }}>MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
              <div style={{ fontSize: 10, color: "#666" }}>G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
              <div style={{ fontSize: 10, color: "#666" }}>GSTIN: 08AAFCM15Q1ZA · ☎ 80941 56965 · temple@mtcpl.co</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#fff", background: "#0f2540", borderRadius: 5, padding: "2px 10px" }}>PREVIEW</span>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 3 }}>{invoiceNo}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
            <div style={party}>
              <div style={kk}>Bill To</div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{bill?.name ?? "—"}</div>
              {bill?.address && <div style={{ fontSize: 10.5, color: "#333" }}>{bill.address}</div>}
              {bill?.gstin && <div style={{ fontSize: 9.5, color: "#555", fontFamily: "ui-monospace, monospace" }}>GSTIN: {bill.gstin}</div>}
            </div>
            <div style={party}>
              <div style={kk}>Ship To</div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{shipName}</div>
              <div style={{ fontSize: 10.5, color: ship?.address ? "#333" : "#999" }}>{ship?.address ?? "Same as billing address"}</div>
            </div>
          </div>
          {challanCode && <div style={{ fontSize: 10, color: "#0f2540", fontWeight: 800, background: "#eef5fd", border: "1px solid #c7ddf6", borderRadius: 6, padding: "5px 9px", marginBottom: 6 }}>Against delivery challan: ({challanCode})</div>}
          {/* Full per-item detail (codes, dims) grouped by stone — a faithful
              preview of the tax invoice, so nothing looks different later. */}
          {groups.map((gr) => (
            <div key={gr.key} style={{ marginBottom: 8 }}>
              {/* 3-zone band: heading (left) · HSN (centre) · stone (right). */}
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#0f2540", background: gr.unit === "cft" ? "#eef5fd" : "#fff5e6", border: "1px solid #d3dae3", borderBottom: "none", borderRadius: "5px 5px 0 0", padding: "4px 9px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "1 1 0", textAlign: "left" }}>{gr.head || gr.stone}</span>
                <span style={{ flex: "0 0 auto", textAlign: "center", fontFamily: "ui-monospace, monospace", color: gr.hsn ? "#555" : "#c00" }}>{gr.hsn ? `HSN ${gr.hsn}` : "HSN —"}</span>
                <span style={{ flex: "1 1 0", textAlign: "right" }}>{gr.head ? gr.stone : ""}</span>
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#0f2540", background: gr.unit === "cft" ? "#eef5fd" : "#fff5e6", borderLeft: "1px solid #d3dae3", borderRight: "1px solid #d3dae3", padding: "0 9px 3px", display: "flex", justifyContent: "space-between", gap: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span>{gr.unit === "cft" ? "CFT · volume billed" : "SFT · area billed"}{mode && gr.gst != null ? ` · GST ${gr.gst}%` : ""}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0 }}>Rate {fmt(gr.rate)}/{gr.unit} · {rupee(gr.rate * gr.meas)}</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={ph}>#</th><th style={{ ...ph, textAlign: "left" }}>Code(s)</th><th style={{ ...ph, textAlign: "left" }}>Label</th><th style={{ ...ph, textAlign: "left" }}>Description</th>
                  <th style={{ ...ph, textAlign: "right" }}>L</th><th style={{ ...ph, textAlign: "right" }}>W</th><th style={{ ...ph, textAlign: "right" }}>H</th>
                  <th style={{ ...ph, textAlign: "right" }}>Qty</th><th style={{ ...ph, textAlign: "right" }}>{gr.unit.toUpperCase()}</th><th style={{ ...ph, textAlign: "right" }}>Amount</th>
                </tr></thead>
                <tbody>
                  {gr.items.map((it, i) => (
                    <tr key={i}>
                      <td style={pcell}>{i + 1}</td>
                      <td style={{ ...pcell, fontFamily: "ui-monospace, monospace" }}>{dash(it.codes)}</td>
                      <td style={pcell}>{dash(it.label)}</td>
                      <td style={pcell}>{dash(it.description)}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{it.l ?? "-"}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{it.w ?? "-"}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{it.h ?? "-"}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{it.qty}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmt(it.meas)}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{rupee(gr.rate * it.meas)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#f3f6fa", fontWeight: 800 }}>
                    <td colSpan={7} style={{ ...pcell, textAlign: "right" }}>Total</td>
                    <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{gr.qty}</td>
                    <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmt(gr.meas)}</td>
                    <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{rupee(gr.rate * gr.meas)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginTop: 10 }}>
            <div style={{ flex: "1 1 auto", maxWidth: "56%" }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "#0f2540", marginBottom: 3 }}>Terms &amp; Conditions</div>
              <ol style={{ margin: 0, paddingLeft: 15 }}>
                <li style={{ fontSize: 8.5, color: "#444", lineHeight: 1.5 }}>Goods once sold will not be taken back.</li>
                <li style={{ fontSize: 8.5, color: "#444", lineHeight: 1.5 }}>Interest @ 24% p.a. from the date of bill.</li>
                <li style={{ fontSize: 8.5, color: "#444", lineHeight: 1.5 }}>All disputes subject to PINDWARA jurisdiction only.</li>
              </ol>
            </div>
            <div style={{ minWidth: 260, border: "1px solid #d3dae3", borderRadius: 8, overflow: "hidden" }}>
              <div style={ptot}><span>Subtotal</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.subtotal)}</span></div>
              {totals.groups.map((g, i) => (
                <div key={i} style={{ ...ptot, background: "#f7fafc" }}><span>{gstGroupLabel(mode, g)}{totals.multi ? ` on ${rupee(g.taxable)}` : ""}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(g.taxAmt)}</span></div>
              ))}
              {disc.amt > 0 ? (
                <>
                  <div style={ptot}><span>Grand Total</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.grand)}</span></div>
                  <div style={{ ...ptot, background: "#f7fafc" }}><span>{discountLabel(disc)}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>−{rupee(disc.amt)}</span></div>
                  <div style={{ ...ptot, background: "#0f2540", color: "#fff", fontWeight: 800, fontSize: 14 }}><span>Amount Payable</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(disc.payable)}</span></div>
                </>
              ) : (
                <div style={{ ...ptot, background: "#0f2540", color: "#fff", fontWeight: 800, fontSize: 14 }}><span>Grand Total</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.grand)}</span></div>
              )}
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead><tr><th style={ph}>Taxable Amount</th><th style={ph}>GST</th><th style={ph}>Total Tax</th><th style={ph}>Invoice Total</th></tr></thead>
            <tbody>
              {totals.groups.length === 0 ? (
                <tr><td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{rupee(totals.subtotal)}</td><td style={pcell}>—</td><td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{rupee(0)}</td><td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{rupee(disc.payable)}</td></tr>
              ) : (
                totals.groups.map((g, i) => (
                  <tr key={i}>
                    <td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{rupee(g.taxable)}</td>
                    <td style={pcell}>{gstGroupLabel(mode, g)}</td>
                    <td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{rupee(g.taxAmt)}</td>
                    {i === 0 && <td style={{ ...pcell, fontFamily: "ui-monospace, monospace", textAlign: "right", fontWeight: 800, verticalAlign: "middle" }} rowSpan={totals.groups.length}>{rupee(disc.payable)}</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 7, fontSize: 11, border: "1px solid #d3dae3", borderRadius: 6, padding: "6px 10px", background: "#f7fafc" }}><strong>Amount in words:</strong> {amountInWordsIN(disc.payable)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 20 }}>
            <div style={{ borderTop: "1.5px solid #888", paddingTop: 4, fontSize: 8.5, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>Customer Signature<div style={{ fontSize: 9.5, color: "#444", textTransform: "none", fontWeight: 600, marginTop: 2 }}>{bill?.name ?? "—"}</div></div>
            <div style={{ borderTop: "1.5px solid #888", paddingTop: 4, fontSize: 8.5, color: "#888", fontWeight: 700, textTransform: "uppercase", textAlign: "right" }}>For MTCPL · Authorised Signatory<div style={{ fontSize: 9.5, marginTop: 2 }}>&nbsp;</div></div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13.5, padding: "10px 20px", fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 10, cursor: "pointer" }}>Close preview</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "3px 0" }}>
      <span style={{ fontSize: big ? 15 : 13, fontWeight: big ? 800 : 600, color: big ? "var(--text)" : "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: big ? 18 : 13.5, fontWeight: big ? 800 : 700, fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}
