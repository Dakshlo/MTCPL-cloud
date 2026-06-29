"use client";

/**
 * Create a bulk tax invoice (Mig 173): pick a temple, tick its bulk challans to
 * cover, type the line items manually (Particulars / HSN / Unit / Qty / Rate /
 * Amount), choose GST (pre-filled from the temple). Live totals. Posts to
 * createBulkInvoiceAction → the invoice waits on owner approval.
 */

import { useMemo, useState } from "react";
import { createBulkInvoiceAction } from "../../actions";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";

export type TempleData = {
  temple: string;
  gst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  challans: { id: string; code: string; date: string }[];
};
type Item = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };

const blankItem = (): Item => ({ particulars: "", hsn: "", unit: "", quantity: "", rate: "" });

export function BulkInvoiceForm({ temples }: { temples: TempleData[] }) {
  const [temple, setTemple] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Item[]>([blankItem(), blankItem()]);
  const [mode, setMode] = useState<GstMode>(null);
  const [igst, setIgst] = useState("18");
  const [cgst, setCgst] = useState("9");
  const [sgst, setSgst] = useState("9");
  const [invoiceNo, setInvoiceNo] = useState("");

  const cur = temples.find((t) => t.temple === temple) ?? null;

  function pickTemple(name: string) {
    setTemple(name);
    setChecked({});
    const t = temples.find((x) => x.temple === name);
    if (t) { setMode(t.gst.mode); setIgst(String(t.gst.igst)); setCgst(String(t.gst.cgst)); setSgst(String(t.gst.sgst)); }
  }

  const amountOf = (it: Item) => (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const totals = useMemo(
    () => computeInvoiceTotals(items.map(amountOf), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, mode, igst, cgst, sgst],
  );

  const challanIds = Object.keys(checked).filter((k) => checked[k]);
  const itemsJson = JSON.stringify(items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) })));
  const hasItems = items.some((it) => it.particulars.trim() || amountOf(it) > 0);

  const setItem = (i: number, k: keyof Item, v: string) => setItems((p) => p.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };
  const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)", marginBottom: 14 };

  return (
    <form action={createBulkInvoiceAction}>
      <input type="hidden" name="temple" value={temple} />
      <input type="hidden" name="challan_ids" value={JSON.stringify(challanIds)} />
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="igst_percent" value={igst} />
      <input type="hidden" name="cgst_percent" value={cgst} />
      <input type="hidden" name="sgst_percent" value={sgst} />
      <input type="hidden" name="invoice_no_override" value={invoiceNo} />

      {/* Temple */}
      <div style={card}>
        <label className="stack" style={{ maxWidth: 420 }}>
          <span>Client (temple)</span>
          <select value={temple} onChange={(e) => pickTemple(e.target.value)} required>
            <option value="">Select a temple…</option>
            {temples.map((t) => <option key={t.temple} value={t.temple}>{t.temple} ({t.challans.length} bulk challan{t.challans.length !== 1 ? "s" : ""})</option>)}
          </select>
        </label>
      </div>

      {/* Challans to include */}
      {cur && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 4 }}>Challans covered by this bill</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>Tick the challans this invoice covers. They&apos;re only linked/referenced — the line items below are typed manually.</div>
          {cur.challans.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No bulk challans for this temple.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {cur.challans.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px solid ${checked[c.id] ? "#15803d" : "var(--border)"}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", background: checked[c.id] ? "rgba(22,101,52,0.06)" : "var(--bg)" }}>
                  <input type="checkbox" checked={!!checked[c.id]} onChange={(e) => setChecked((p) => ({ ...p, [c.id]: e.target.checked }))} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12.5, display: "block" }}>{c.code}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{c.date}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual line items */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 10 }}>Line items</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--surface)" }}>
                <th style={{ ...cell, width: 28 }}>#</th>
                <th style={{ ...cell, textAlign: "left" }}>Item / Particulars</th>
                <th style={{ ...cell, width: 110 }}>HSN</th>
                <th style={{ ...cell, width: 80 }}>Unit</th>
                <th style={{ ...cell, width: 90 }}>Qty</th>
                <th style={{ ...cell, width: 110 }}>Rate</th>
                <th style={{ ...cell, width: 120, textAlign: "right" }}>Amount</th>
                <th style={{ ...cell, width: 34 }} />
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
        <button type="button" onClick={() => setItems((p) => [...p, blankItem()])} style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>＋ Add line</button>
      </div>

      {/* GST + totals */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ flex: "1 1 320px", ...card, marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 10 }}>GST</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {([["none", "No GST"], ["igst", "IGST"], ["cgst_sgst", "CGST + SGST"]] as const).map(([val, label]) => {
              const on = (mode ?? "none") === val;
              return (
                <button key={val} type="button" onClick={() => setMode(val === "none" ? null : (val as GstMode))} style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--bg)", color: on ? "#fff" : "var(--text)" }}>{label}</button>
              );
            })}
          </div>
          {mode === "igst" && <label className="stack" style={{ maxWidth: 140 }}><span>IGST %</span><input value={igst} onChange={(e) => setIgst(e.target.value)} inputMode="decimal" /></label>}
          {mode === "cgst_sgst" && (
            <div style={{ display: "flex", gap: 10 }}>
              <label className="stack" style={{ maxWidth: 120 }}><span>CGST %</span><input value={cgst} onChange={(e) => setCgst(e.target.value)} inputMode="decimal" /></label>
              <label className="stack" style={{ maxWidth: 120 }}><span>SGST %</span><input value={sgst} onChange={(e) => setSgst(e.target.value)} inputMode="decimal" /></label>
            </div>
          )}
          <label className="stack" style={{ maxWidth: 220, marginTop: 12 }}><span>Invoice no. override <span className="muted" style={{ fontWeight: 600 }}>(optional)</span></span><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></label>
        </div>
        <div style={{ flex: "0 0 280px", ...card, marginBottom: 0 }}>
          <Row label="Subtotal" value={rupee(totals.subtotal)} />
          {mode === "igst" && <Row label={`IGST @ ${igst || 0}%`} value={rupee(totals.igstAmt)} />}
          {mode === "cgst_sgst" && (<><Row label={`CGST @ ${cgst || 0}%`} value={rupee(totals.cgstAmt)} /><Row label={`SGST @ ${sgst || 0}%`} value={rupee(totals.sgstAmt)} /></>)}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} bold /></div>
        </div>
      </div>

      <button type="submit" disabled={!temple || !hasItems} style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: temple && hasItems ? "#0f172a" : "var(--border)", border: "none", borderRadius: 11, cursor: temple && hasItems ? "pointer" : "default" }}>
        🧾 Create tax invoice → owner approval
      </button>
    </form>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "4px 0", fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 600 }}>
      <span>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}
