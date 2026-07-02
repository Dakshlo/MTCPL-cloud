"use client";

/**
 * Mig 177 — the "Dropped" section on the Challans page. A dropped challan is
 * re-billed as a custom whole-piece bill (free line items, SAME CH number);
 * creating the bill delivers the production dispatch. The custom bill → tax
 * invoice (INV number on the shared series).
 */

import { useState } from "react";
import Link from "next/link";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { financialYear } from "@/lib/doc-code";
import { createCustomBillAction, convertCustomBillToInvoiceAction, undropChallanAction } from "../actions";
import type { DroppedChallan } from "./challans-board";

type Item = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };
const blank = (): Item => ({ particulars: "", hsn: "", unit: "", quantity: "", rate: "" });

export function DroppedSection({ dropped, showHeader = true }: { dropped: DroppedChallan[]; showHeader?: boolean }) {
  const [billing, setBilling] = useState<DroppedChallan | null>(null);
  const [converting, setConverting] = useState<DroppedChallan | null>(null);

  return (
    <div style={{ marginTop: showHeader ? 24 : 0 }}>
      {showHeader && (
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5b21b6", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          🎯 Dropped — custom whole-piece bills <span style={pill}>{dropped.length}</span>
        </div>
      )}
      {dropped.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          No dropped challans. On the <strong>Challans</strong> page, drag a challan onto the <strong>🎯 Custom bill</strong> drop zone.
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {dropped.map((d) => <DroppedCard key={d.id} d={d} onBill={() => setBilling(d)} onConvert={() => setConverting(d)} />)}
      </div>
      )}
      {billing && <BillForm d={billing} onClose={() => setBilling(null)} />}
      {converting && <ConvertModal d={converting} onClose={() => setConverting(null)} />}
    </div>
  );
}

function DroppedCard({ d, onBill, onConvert }: { d: DroppedChallan; onBill: () => void; onConvert: () => void }) {
  const total = computeInvoiceTotals(d.items.map((i) => i.amount), { mode: d.gstMode, igst: d.igst, cgst: d.cgst, sgst: d.sgst }).grand;
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: "4px solid #8b5cf6", borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>{d.code}</span>
        {d.customBilled
          ? <span style={{ fontSize: 10, fontWeight: 800, color: "#5b21b6", background: "rgba(139,92,246,0.14)", borderRadius: 999, padding: "2px 9px" }}>✓ CUSTOM BILL</span>
          : <span style={{ fontSize: 10, fontWeight: 800, color: "#92400e", background: "rgba(245,158,11,0.16)", borderRadius: 999, padding: "2px 9px" }}>🎯 DROPPED</span>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>🏛 {d.temple}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
        📅 {new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
        {d.customBilled ? <> · {d.items.length} item{d.items.length !== 1 ? "s" : ""} · <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{rupee(total)}</strong></> : null}
      </div>
      {(d.transport.vehicle || d.transport.driver) && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>🚚 {[d.transport.vehicle, d.transport.driver].filter(Boolean).join(" · ")}</div>
      )}
      <div style={{ marginTop: 2, display: "flex", gap: 7, flexWrap: "wrap" }}>
        {d.sourceDispatchId && (
          <Link href={`/dispatch/${d.sourceDispatchId}/print?draft=1`} target="_blank" rel="noopener noreferrer" style={btnSmall}>🖨 Draft challan</Link>
        )}
        {d.customBilled ? (
          <>
            <Link href={`/invoicing/challan/${d.id}/custom/print`} target="_blank" rel="noopener noreferrer" style={btnSmall}>🖨 Bill</Link>
            <button type="button" onClick={onConvert} style={{ ...btnSmall, color: "#fff", background: "#0f172a", border: "1px solid #0f172a" }}>🧾 Create invoice</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onBill} style={{ ...btnSmall, color: "#fff", background: "#6d28d9", border: "1px solid #5b21b6" }}>🧾 Create custom bill</button>
            <form action={undropChallanAction} onSubmit={(e) => { if (!confirm("Bring this challan back to the board?")) e.preventDefault(); }}>
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" style={btnSmall}>↩ Un-drop</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function BillForm({ d, onClose }: { d: DroppedChallan; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([blank()]);
  const [mode, setMode] = useState<GstMode>(d.gstMode);
  const [igst, setIgst] = useState(String(d.igst || 18));
  const [cgst, setCgst] = useState(String(d.cgst || 9));
  const [sgst, setSgst] = useState(String(d.sgst || 9));
  const amountOf = (it: Item) => (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const totals = computeInvoiceTotals(items.map(amountOf), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 });
  const itemsJson = JSON.stringify(items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) })));
  const hasItems = items.some((it) => it.particulars.trim() || amountOf(it) > 0);
  const setItem = (i: number, k: keyof Item, v: string) => setItems((p) => p.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };
  const fld: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const tlbl = (s: string) => <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{s}</span>;

  return (
    <div onMouseDown={onClose} style={overlay}>
      <form action={createCustomBillAction} onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)", background: "var(--surface, #fff)", borderRadius: 14, padding: 18, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", maxHeight: "92vh", overflowY: "auto" }}>
        <input type="hidden" name="challan_id" value={d.id} />
        <input type="hidden" name="items" value={itemsJson} />
        <input type="hidden" name="gst_mode" value={mode ?? ""} />
        <input type="hidden" name="igst_percent" value={igst} />
        <input type="hidden" name="cgst_percent" value={cgst} />
        <input type="hidden" name="sgst_percent" value={sgst} />

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Custom bill — {d.code} <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>· 🏛 {d.temple}</span></div>
          <button type="button" onClick={onClose} style={btnGhost}>Close</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>Type the whole-piece line(s). This keeps the CH number and <strong>delivers the production dispatch</strong> (no on-road leg).</p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 680 }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={{ ...cell, width: 26 }}>#</th>
                <th style={{ ...cell, textAlign: "left" }}>Item / Particulars</th>
                <th style={{ ...cell, width: 100 }}>HSN</th>
                <th style={{ ...cell, width: 74 }}>Unit</th>
                <th style={{ ...cell, width: 84 }}>Qty</th>
                <th style={{ ...cell, width: 100 }}>Rate</th>
                <th style={{ ...cell, width: 110, textAlign: "right" }}>Amount</th>
                <th style={{ ...cell, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>{i + 1}</td>
                  <td style={cell}><input value={it.particulars} onChange={(e) => setItem(i, "particulars", e.target.value)} style={inp} placeholder="Whole piece / description" /></td>
                  <td style={cell}><input value={it.hsn} onChange={(e) => setItem(i, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                  <td style={cell}><input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} style={inp} placeholder="Nos" /></td>
                  <td style={cell}><input value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} inputMode="decimal" style={num} /></td>
                  <td style={cell}><input value={it.rate} onChange={(e) => setItem(i, "rate", e.target.value)} inputMode="decimal" style={num} /></td>
                  <td style={{ ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{rupee(amountOf(it))}</td>
                  <td style={{ ...cell, textAlign: "center" }}>
                    <button type="button" onClick={() => setItems((p) => p.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setItems((p) => [...p, blank()])} style={{ ...btnGhost, marginTop: 10 }}>＋ Add line</button>

        {/* Transportation — prefilled from the dispatch/challan; editable. Printed on the bill. */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)", marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>🚚 Transportation <span style={{ fontWeight: 600, textTransform: "none" }}>(from the dispatch — edit if needed)</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <label className="stack">{tlbl("Transport company")}<input name="transport_company" defaultValue={d.transport.company} style={fld} /></label>
            <label className="stack">{tlbl("Vehicle no.")}<input name="transport_vehicle_no" defaultValue={d.transport.vehicle} style={{ ...fld, fontFamily: "ui-monospace, monospace" }} /></label>
            <label className="stack">{tlbl("Driver")}<input name="transport_driver_name" defaultValue={d.transport.driver} style={fld} /></label>
            <label className="stack">{tlbl("Driver phone")}<input name="transport_driver_phone" defaultValue={d.transport.driverPhone} style={fld} /></label>
            <label className="stack">{tlbl("LR no.")}<input name="lr_no" defaultValue={d.transport.lr} style={fld} /></label>
            <label className="stack">{tlbl("Transport phone")}<input name="transport_phone" defaultValue={d.transport.phone} style={fld} /></label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 14 }}>
          <div style={{ flex: "1 1 300px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>GST</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {([["none", "No GST"], ["igst", "IGST"], ["cgst_sgst", "CGST + SGST"]] as const).map(([val, label]) => {
                const on = (mode ?? "none") === val;
                return <button key={val} type="button" onClick={() => setMode(val === "none" ? null : (val as GstMode))} style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--bg)", color: on ? "#fff" : "var(--text)" }}>{label}</button>;
              })}
            </div>
            {mode === "igst" && <label className="stack" style={{ maxWidth: 140 }}><span>IGST %</span><input value={igst} onChange={(e) => setIgst(e.target.value)} inputMode="decimal" /></label>}
            {mode === "cgst_sgst" && (
              <div style={{ display: "flex", gap: 10 }}>
                <label className="stack" style={{ maxWidth: 120 }}><span>CGST %</span><input value={cgst} onChange={(e) => setCgst(e.target.value)} inputMode="decimal" /></label>
                <label className="stack" style={{ maxWidth: 120 }}><span>SGST %</span><input value={sgst} onChange={(e) => setSgst(e.target.value)} inputMode="decimal" /></label>
              </div>
            )}
          </div>
          <div style={{ flex: "0 0 260px", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)" }}>
            <Row label="Subtotal" value={rupee(totals.subtotal)} />
            {mode === "igst" && <Row label={`IGST @ ${igst || 0}%`} value={rupee(totals.igstAmt)} />}
            {mode === "cgst_sgst" && <><Row label={`CGST @ ${cgst || 0}%`} value={rupee(totals.cgstAmt)} /><Row label={`SGST @ ${sgst || 0}%`} value={rupee(totals.sgstAmt)} /></>}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} bold /></div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" disabled={!hasItems} style={{ ...btnPrimary, background: hasItems ? "#6d28d9" : "var(--border)", cursor: hasItems ? "pointer" : "default" }}>🧾 Create custom bill &amp; deliver</button>
          {!hasItems && <span style={{ fontSize: 12, color: "var(--muted)" }}>Add at least one line item.</span>}
        </div>
      </form>
    </div>
  );
}

function ConvertModal({ d, onClose }: { d: DroppedChallan; onClose: () => void }) {
  const [num, setNum] = useState("");
  const invPrefix = `INV-${financialYear(d.date)}-`;
  return (
    <div onMouseDown={onClose} style={overlay}>
      <form action={convertCustomBillToInvoiceAction} onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <input type="hidden" name="challan_id" value={d.id} />
        <input type="hidden" name="inv_seq" value={num} />
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>🧾 Invoice {d.code}</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px" }}>Assigns an invoice number on the shared series. Leave blank for the next auto number.</p>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
        <div style={{ display: "inline-flex", alignItems: "stretch", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "8px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, background: "var(--surface)", color: "var(--muted)", borderRight: "1.5px solid var(--border)" }}>{invPrefix}</span>
          <input value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="auto" style={{ width: 90, textAlign: "left", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, padding: "8px 10px", border: "none", background: "transparent", color: "var(--text)" }} />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" style={{ ...btnPrimary, background: "#0f172a" }}>🧾 Create invoice</button>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "4px 0", fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 600 }}>
      <span>{label}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" };
const pill: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" };
const btnPrimary: React.CSSProperties = { fontSize: 14, padding: "11px 22px", fontWeight: 800, color: "#fff", border: "none", borderRadius: 11, cursor: "pointer" };
const btnGhost: React.CSSProperties = { fontSize: 13, padding: "9px 16px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, cursor: "pointer" };
const btnSmall: React.CSSProperties = { fontSize: 12, padding: "7px 11px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", textDecoration: "none" };
