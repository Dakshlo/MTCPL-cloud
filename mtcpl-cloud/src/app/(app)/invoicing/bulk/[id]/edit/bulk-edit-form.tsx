"use client";

/** Edit a work order (bulk) invoice — tables/heads / line items / GST / notes.
 *  The INV number is LOCKED (Daksh Jul 2026). Posts updateBulkInvoiceAction. */

import { useMemo, useState } from "react";
import { updateBulkInvoiceAction } from "../../../actions";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { BULK_UNITS } from "@/lib/bulk-items";

type Line = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };
type Section = { head: string; lines: Line[] };

export function BulkEditForm({ id, invoiceCode, initSections, initGst, initNotes, challans, linkedIds }: {
  id: string;
  invoiceCode: string;
  initSections: Array<{ head: string; lines: Array<{ particulars: string; hsn: string; unit: string; quantity: number; rate: number }> }>;
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  initNotes: string;
  challans: Array<{ id: string; code: string; date: string }>;
  linkedIds: string[];
}) {
  const [sections, setSections] = useState<Section[]>(() =>
    initSections.map((s) => ({ head: s.head, lines: s.lines.map((l) => ({ particulars: l.particulars, hsn: l.hsn, unit: l.unit, quantity: l.quantity ? String(l.quantity) : "", rate: l.rate ? String(l.rate) : "" })) })),
  );
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [igst, setIgst] = useState(String(initGst.igst || 18));
  const [cgst, setCgst] = useState(String(initGst.cgst || 9));
  const [sgst, setSgst] = useState(String(initGst.sgst || 9));
  const [notes, setNotes] = useState(initNotes);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(linkedIds));
  const toggleChallan = (cid: string) => setSelected((p) => { const n = new Set(p); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });

  const amountOf = (l: Line) => (Number(l.quantity) || 0) * (Number(l.rate) || 0);
  const setLine = (si: number, li: number, k: keyof Line, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.map((l, j) => (j === li ? { ...l, [k]: v } : l)) } : s)));
  const setHead = (si: number, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, head: v } : s)));
  const addLine = (si: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: [...s.lines, { particulars: "", hsn: "", unit: "", quantity: "", rate: "" }] } : s)));
  const removeLine = (si: number, li: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.filter((_, j) => j !== li) } : s)));
  const addTable = () => setSections((p) => [...p, { head: "", lines: [{ particulars: "", hsn: "", unit: "", quantity: "", rate: "" }] }]);
  const removeTable = (si: number) => setSections((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== si)));

  const serialItems = useMemo(
    () => sections.flatMap((s, si) =>
      s.lines
        .filter((l) => l.particulars.trim() || Number(l.quantity) || Number(l.rate))
        .map((l) => ({ particulars: l.particulars, hsn: l.hsn, unit: l.unit, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, amount: amountOf(l), section_index: si, section_head: s.head.trim() || null })),
    ),
    [sections],
  );
  const totals = computeInvoiceTotals(serialItems.map((i) => i.amount), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 });
  const itemsJson = JSON.stringify(serialItems);
  const hasItems = serialItems.length > 0;

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
      <input type="hidden" name="challan_ids" value={JSON.stringify([...selected])} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15 }}>{invoiceCode}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.1)", borderRadius: 999, padding: "2px 8px" }}>🔒 NUMBER LOCKED</span>
      </div>

      {challans.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "var(--bg)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>📋 Delivery challans on this invoice <span style={{ fontWeight: 600, textTransform: "none" }}>· tick to include, untick to return it to the Bulk pool</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
            {challans.map((c) => {
              const on = selected.has(c.id);
              return (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(180,83,9,0.06)" : "var(--surface)", cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggleChallan(c.id)} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12.5 }}>{c.code}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)" }}>{new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>{selected.size} selected · the change takes effect when the edit is approved.</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {sections.map((s, si) => (
          <div key={si} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
              <input value={s.head} onChange={(e) => setHead(si, e.target.value)} placeholder="Table head (e.g. PinkStone)" style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, padding: "3px 4px" }} />
              {sections.length > 1 && <button type="button" onClick={() => removeTable(si)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✕ Table</button>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
                <thead>
                  <tr style={{ background: "var(--surface)" }}>
                    <th style={{ ...cell, width: 24 }}>#</th>
                    <th style={{ ...cell, textAlign: "left" }}>Item / Particulars</th>
                    <th style={{ ...cell, width: 90 }}>HSN</th>
                    <th style={{ ...cell, width: 92 }}>Unit</th>
                    <th style={{ ...cell, width: 78 }}>Qty</th>
                    <th style={{ ...cell, width: 92 }}>Rate</th>
                    <th style={{ ...cell, width: 104, textAlign: "right" }}>Amount</th>
                    <th style={{ ...cell, width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l, li) => (
                    <tr key={li}>
                      <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>{li + 1}</td>
                      <td style={cell}><input value={l.particulars} onChange={(e) => setLine(si, li, "particulars", e.target.value)} style={inp} /></td>
                      <td style={cell}><input value={l.hsn} onChange={(e) => setLine(si, li, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                      <td style={cell}>
                        <select value={l.unit} onChange={(e) => setLine(si, li, "unit", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                          <option value="">Unit…</option>
                          {BULK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          {l.unit && !BULK_UNITS.includes(l.unit as (typeof BULK_UNITS)[number]) && <option value={l.unit}>{l.unit}</option>}
                        </select>
                      </td>
                      <td style={cell}><input value={l.quantity} onChange={(e) => setLine(si, li, "quantity", e.target.value)} inputMode="decimal" style={num} /></td>
                      <td style={cell}><input value={l.rate} onChange={(e) => setLine(si, li, "rate", e.target.value)} inputMode="decimal" style={num} /></td>
                      <td style={{ ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{rupee(amountOf(l))}</td>
                      <td style={{ ...cell, textAlign: "center" }}>
                        {s.lines.length > 1 && <button type="button" onClick={() => removeLine(si, li)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800 }}>✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "8px 10px" }}>
              <button type="button" onClick={() => addLine(si)} style={{ fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>＋ Add line</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={addTable} style={{ marginTop: 12, fontSize: 12.5, fontWeight: 800, padding: "9px 15px", borderRadius: 9, border: "1.5px dashed var(--gold-dark)", background: "rgba(180,83,9,0.06)", color: "var(--gold-dark)", cursor: "pointer" }}>＋ Add table (new head)</button>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 16 }}>
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
