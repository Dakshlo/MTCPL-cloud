"use client";

/**
 * Create a bulk tax invoice (Mig 173): pick a temple, tick its bulk challans to
 * cover, type the line items manually (Particulars / HSN / Unit / Qty / Rate /
 * Amount), choose GST (pre-filled from the temple). Live totals + a live PREVIEW
 * (👁) that renders the invoice with the NOT-VALID watermark before submitting.
 * Posts to createBulkInvoiceAction → the invoice waits on owner approval.
 */

import { useMemo, useState } from "react";
import { createBulkInvoiceAction } from "../../actions";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { BulkInvoicePreview, type PreviewParty } from "./bulk-invoice-preview";

export type TempleData = {
  temple: string;
  gst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  challans: { id: string; code: string; date: string }[];
  bill: PreviewParty | null;
  ship: PreviewParty | null;
  vendorCode: string | null;
  workOrderNo: string | null;
};
type Item = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };

const blankItem = (): Item => ({ particulars: "", hsn: "", unit: "", quantity: "", rate: "" });
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

export function BulkInvoiceForm({ temples, invPrefix, autoNum }: { temples: TempleData[]; invPrefix: string; autoNum: string }) {
  const [temple, setTemple] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [mode, setMode] = useState<GstMode>(null);
  const [igst, setIgst] = useState("18");
  const [cgst, setCgst] = useState("9");
  const [sgst, setSgst] = useState("9");
  const [invNum, setInvNum] = useState("");
  const [showPreview, setShowPreview] = useState(false);

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
  const coveredCount = challanIds.length;
  const coveredCodes = (cur?.challans ?? []).filter((c) => checked[c.id]).map((c) => c.code);
  const itemsJson = JSON.stringify(items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) })));
  const previewItems = items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) }));
  const hasItems = items.some((it) => it.particulars.trim() || amountOf(it) > 0);

  const setItem = (i: number, k: keyof Item, v: string) => setItems((p) => p.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  const canSubmit = !!temple && hasItems;

  return (
    <form action={createBulkInvoiceAction}>
      <input type="hidden" name="temple" value={temple} />
      <input type="hidden" name="challan_ids" value={JSON.stringify(challanIds)} />
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="igst_percent" value={igst} />
      <input type="hidden" name="cgst_percent" value={cgst} />
      <input type="hidden" name="sgst_percent" value={sgst} />
      <input type="hidden" name="inv_seq" value={invNum} />

      {/* 1 — Temple */}
      <Section step={1} title="Client (temple)" subtitle="Which temple is this invoice billed to?">
        <label className="stack" style={{ maxWidth: 460 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Temple</span>
          <select value={temple} onChange={(e) => pickTemple(e.target.value)} required style={FIELD}>
            <option value="">Select a temple…</option>
            {temples.map((t) => <option key={t.temple} value={t.temple}>{t.temple} ({t.challans.length} bulk challan{t.challans.length !== 1 ? "s" : ""})</option>)}
          </select>
        </label>
        {cur?.bill && (cur.bill.gstin || cur.bill.address) && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text)" }}>{cur.bill.name}</strong>
            {cur.bill.address ? ` · ${cur.bill.address}` : ""}{cur.bill.gstin ? ` · GSTIN ${cur.bill.gstin}` : ""}
          </div>
        )}
      </Section>

      {/* 2 — Challans covered */}
      {cur && (
        <Section step={2} title="Challans covered by this bill" subtitle="Tick the challans this invoice covers — they're only linked/referenced; the line items are typed below.">
          {cur.challans.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No bulk challans for this temple.</div>
          ) : (
            <>
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
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: coveredCount ? "#15803d" : "var(--muted)" }}>
                {coveredCount ? `✓ ${coveredCount} challan${coveredCount !== 1 ? "s" : ""} selected` : "No challans selected yet"}
              </div>
            </>
          )}
        </Section>
      )}

      {/* 3 — Line items */}
      <Section step={3} title="Line items" subtitle="Typed manually. Amount = Qty × Rate.">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
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
                  <td style={cell}><input value={it.particulars} onChange={(e) => setItem(i, "particulars", e.target.value)} style={inp} placeholder="Description of goods / work" /></td>
                  <td style={cell}><input value={it.hsn} onChange={(e) => setItem(i, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                  <td style={cell}><input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} style={inp} placeholder="Nos / Sft" /></td>
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
      </Section>

      {/* 4 — GST + totals */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch", marginBottom: 16 }}>
        <div style={{ flex: "1 1 340px" }}>
          <Section step={4} title="GST" subtitle="Pre-filled from the temple. Vendor-HSN temples are 18%.">
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
            {/* Invoice no. — fixed INV-<FY>- prefix, edit only the number. */}
            <div style={{ marginTop: 14 }}>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
              <div style={{ display: "inline-flex", alignItems: "stretch", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "8px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, background: "var(--surface)", color: "var(--muted)", borderRight: "1.5px solid var(--border)" }}>{invPrefix}</span>
                <input value={invNum} onChange={(e) => setInvNum(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder={autoNum} style={{ width: 90, textAlign: "left", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, padding: "8px 10px", border: "none", background: "transparent", color: "var(--text)" }} />
              </div>
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 5 }}>Leave blank to auto-number as <strong style={{ fontFamily: "ui-monospace, monospace" }}>{invPrefix}{autoNum}</strong>.</span>
            </div>
          </Section>
        </div>
        <div style={{ flex: "0 0 300px" }}>
          <div style={{ ...CARD, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <Row label="Subtotal" value={rupee(totals.subtotal)} />
            {mode === "igst" && <Row label={`IGST @ ${igst || 0}%`} value={rupee(totals.igstAmt)} />}
            {mode === "cgst_sgst" && (<><Row label={`CGST @ ${cgst || 0}%`} value={rupee(totals.cgstAmt)} /><Row label={`SGST @ ${sgst || 0}%`} value={rupee(totals.sgstAmt)} /></>)}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} bold /></div>
          </div>
        </div>
      </div>

      {/* CTA row — Preview + Create */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          disabled={!temple}
          style={{ fontSize: 13.5, padding: "12px 20px", fontWeight: 800, color: temple ? "#0f2540" : "var(--muted)", background: "var(--surface, #fff)", border: `1.5px solid ${temple ? "#0f2540" : "var(--border)"}`, borderRadius: 11, cursor: temple ? "pointer" : "default" }}
        >
          👁 Preview invoice
        </button>
        <button type="submit" disabled={!canSubmit} style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: canSubmit ? "#0f172a" : "var(--border)", border: "none", borderRadius: 11, cursor: canSubmit ? "pointer" : "default" }}>
          🧾 Create work order invoice → owner approval
        </button>
        {!canSubmit && <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick a temple and add at least one line item.</span>}
      </div>

      {showPreview && (
        <BulkInvoicePreview
          bill={cur?.bill ?? null}
          ship={cur?.ship ?? null}
          vendorCode={cur?.vendorCode ?? null}
          workOrderNo={cur?.workOrderNo ?? null}
          coveredCodes={coveredCodes}
          items={previewItems}
          mode={mode}
          igst={Number(igst) || 0}
          cgst={Number(cgst) || 0}
          sgst={Number(sgst) || 0}
          invoiceNo={invNum ? `${invPrefix}${invNum.padStart(2, "0")}` : ""}
          invoiceDate={todayIST()}
          onClose={() => setShowPreview(false)}
        />
      )}
    </form>
  );
}

function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subtitle ? 2 : 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 999, background: "var(--gold)", color: "#fff", fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{step}</span>
        <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>{title}</span>
      </div>
      {subtitle && <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px 34px" }}>{subtitle}</div>}
      {children}
    </div>
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

const CARD: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)", marginBottom: 14 };
const FIELD: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 };
