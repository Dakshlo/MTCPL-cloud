"use client";

/** Edit a bulk (work-order) invoice — line items / GST / notes. The INV number
 *  is LOCKED (Daksh Jul 2026). Posts updateBulkInvoiceAction. */

import { useState } from "react";
import { updateBulkInvoiceAction } from "../../../actions";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";

type Item = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };

export function BulkEditForm({ id, invoiceCode, initItems, initGst, initNotes }: {
  id: string;
  invoiceCode: string;
  initItems: Array<{ particulars: string; hsn: string; unit: string; quantity: number; rate: number }>;
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  initNotes: string;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    initItems.length
      ? initItems.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: it.quantity ? String(it.quantity) : "", rate: it.rate ? String(it.rate) : "" }))
      : [{ particulars: "", hsn: "", unit: "", quantity: "", rate: "" }],
  );
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [igst, setIgst] = useState(String(initGst.igst || 18));
  const [cgst, setCgst] = useState(String(initGst.cgst || 9));
  const [sgst, setSgst] = useState(String(initGst.sgst || 9));
  const [notes, setNotes] = useState(initNotes);

  const amountOf = (it: Item) => (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const totals = computeInvoiceTotals(items.map(amountOf), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 });
  const itemsJson = JSON.stringify(items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) })));
  const hasItems = items.some((it) => it.particulars.trim() || amountOf(it) > 0);
  const setItem = (i: number, k: keyof Item, v: string) => setItems((p) => p.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  return (
    <form action={updateBulkInvoiceAction} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="igst_percent" value={igst} />
      <input type="hidden" name="cgst_percent" value={cgst} />
      <input type="hidden" name="sgst_percent" value={sgst} />
      <input type="hidden" name="notes" value={notes} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15 }}>{invoiceCode}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.1)", borderRadius: 999, padding: "2px 8px" }}>🔒 NUMBER LOCKED</span>
      </div>

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
                <td style={cell}><input value={it.particulars} onChange={(e) => setItem(i, "particulars", e.target.value)} style={inp} /></td>
                <td style={cell}><input value={it.hsn} onChange={(e) => setItem(i, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                <td style={cell}><input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} style={inp} /></td>
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
      <button type="button" onClick={() => setItems((p) => [...p, { particulars: "", hsn: "", unit: "", quantity: "", rate: "" }])} style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", marginTop: 10 }}>＋ Add line</button>

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
          <label className="stack" style={{ marginTop: 12, maxWidth: 460 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Notes (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} /></label>
        </div>
        <div style={{ flex: "0 0 260px", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>Subtotal</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.subtotal)}</span></div>
          {mode === "igst" && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>IGST @ {igst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.igstAmt)}</span></div>}
          {mode === "cgst_sgst" && <><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>CGST @ {cgst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.cgstAmt)}</span></div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>SGST @ {sgst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.sgstAmt)}</span></div></>}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800 }}><span>Grand Total</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.grand)}</span></div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={!hasItems} style={{ fontSize: 14, padding: "11px 22px", fontWeight: 800, color: "#fff", background: hasItems ? "#0f172a" : "var(--border)", border: "none", borderRadius: 11, cursor: hasItems ? "pointer" : "default" }}>
          💾 Save invoice changes (number unchanged)
        </button>
      </div>
    </form>
  );
}
