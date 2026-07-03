"use client";

/** Convert an OTHER-SALES challan → invoice (Daksh, mig 176 two-step). Split:
 *  the other-sales challan iframe LEFT, item tables (fixed particulars/qty,
 *  editable RATE) + GST RIGHT. "Convert to invoice" posts convertOtherChallanAction;
 *  👁 Preview shows the full tax invoice (BulkInvoicePreview, NOT VALID watermark). */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { convertOtherChallanAction } from "../../actions";
import { BulkInvoicePreview, type PreviewParty } from "../../../bulk/new/bulk-invoice-preview";

type Line = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };
type Section = { head: string; lines: Line[] };

function ConvertBtn({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Making the invoice…" />
      <button type="submit" disabled={pending} style={{ fontSize: 14.5, fontWeight: 800, padding: "12px 22px", borderRadius: 11, border: "none", color: "#fff", background: pending ? "var(--border)" : "#0f172a", cursor: pending ? "default" : "pointer" }}>
        {pending ? "Saving…" : edit ? "💾 Save invoice changes →" : "🧾 Convert to invoice →"}
      </button>
    </>
  );
}

export function OtherInvoiceForm({ id, chCode, party, editMode, initSections, initGst, bill, ship, invLabel }: {
  id: string; chCode: string; party: string; editMode: boolean;
  initSections: Array<{ head: string; lines: Array<{ particulars: string; hsn: string; unit: string; quantity: string; rate: string }> }>;
  initGst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  bill: PreviewParty | null; ship: PreviewParty | null; invLabel: string;
}) {
  const [sections, setSections] = useState<Section[]>(() => (initSections.length ? initSections.map((s) => ({ head: s.head, lines: s.lines.map((l) => ({ ...l })) })) : []));
  const [mode, setMode] = useState<GstMode>(initGst.mode);
  const [igst, setIgst] = useState(String(initGst.igst || 18));
  const [cgst, setCgst] = useState(String(initGst.cgst || 9));
  const [sgst, setSgst] = useState(String(initGst.sgst || 9));
  const [showPreview, setShowPreview] = useState(false);

  const setRate = (si: number, li: number, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.map((l, j) => (j === li ? { ...l, rate: v.replace(/[^0-9.]/g, "") } : l)) } : s)));
  const amountOf = (l: Line) => (Number(l.quantity) || 0) * (Number(l.rate) || 0);

  const serialItems = useMemo(
    () => sections.flatMap((s, si) => s.lines.map((l) => ({ particulars: l.particulars, hsn: l.hsn, unit: l.unit, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, amount: amountOf(l), section_index: si, section_head: s.head.trim() || null }))),
    [sections],
  );
  const totals = computeInvoiceTotals(serialItems.map((i) => i.amount), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 });
  const itemsJson = JSON.stringify(serialItems);
  const allRated = serialItems.length > 0 && serialItems.every((i) => i.rate > 0);

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)", fontSize: 12.5 };
  const ro: React.CSSProperties = { ...cell, color: "var(--muted)" };
  const rateInp: React.CSSProperties = { width: "100%", textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "5px 8px", borderRadius: 7, border: "1.5px solid var(--gold-dark)", background: "var(--bg)", color: "var(--text)" };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 40 }}>
      {/* LEFT — the other-sales challan. */}
      <div style={{ flex: "1 1 500px", minWidth: 360, position: "sticky", top: 10, display: "flex", flexDirection: "column", height: "calc(100vh - 20px)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", marginTop: 44 }}>
        <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>🧾 Other Sales challan — {chCode}</span>
          <Link href={`/invoicing/other/${id}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none", whiteSpace: "nowrap" }}>Open full ↗</Link>
        </div>
        <iframe src={`/invoicing/other/${id}/print`} title="Other Sales challan" style={{ flex: 1, width: "100%", border: "none", background: "#f0f0f0" }} />
      </div>

      {/* RIGHT — pricing form. */}
      <div style={{ flex: "1 1 520px", minWidth: 360, marginTop: 44 }}>
        <Link href="/invoicing/other" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Other Sales</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, marginBottom: 2 }}>
          <h1 style={{ margin: 0, fontSize: 21 }}>{editMode ? "Edit invoice" : "Convert to invoice"}</h1>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{chCode}</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.1)", borderRadius: 999, padding: "2px 8px" }}>🔒 {invLabel}</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 16px" }}>🏢 {party} · add a rate for each line + GST. Items come from the challan.</p>

        <form action={convertOtherChallanAction}>
          <input type="hidden" name="other_challan_id" value={id} />
          <input type="hidden" name="edit_mode" value={editMode ? "1" : ""} />
          <input type="hidden" name="items" value={itemsJson} />
          <input type="hidden" name="gst_mode" value={mode ?? ""} />
          <input type="hidden" name="igst_percent" value={igst} />
          <input type="hidden" name="cgst_percent" value={cgst} />
          <input type="hidden" name="sgst_percent" value={sgst} />

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sections.map((s, si) => (
              <div key={si} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                {(sections.length > 1 || s.head.trim()) && <div style={{ padding: "7px 11px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 800 }}>{s.head.trim() || `Table ${si + 1}`}</div>}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: "var(--surface)" }}>
                        <th style={cell}>#</th><th style={{ ...cell, textAlign: "left" }}>Particulars</th><th style={cell}>Unit</th><th style={{ ...cell, textAlign: "right" }}>Qty</th><th style={{ ...cell, textAlign: "right", width: 100 }}>Rate ₹</th><th style={{ ...cell, textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l, li) => (
                        <tr key={li}>
                          <td style={{ ...ro, textAlign: "center" }}>{li + 1}</td>
                          <td style={ro}>{l.particulars || "-"}{l.hsn ? <span style={{ fontFamily: "ui-monospace, monospace", opacity: 0.7 }}> · {l.hsn}</span> : null}</td>
                          <td style={ro}>{l.unit || "-"}</td>
                          <td style={{ ...ro, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{l.quantity || "-"}</td>
                          <td style={cell}><input value={l.rate} onChange={(e) => setRate(si, li, e.target.value)} inputMode="decimal" placeholder="0" style={rateInp} /></td>
                          <td style={{ ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{rupee(amountOf(l))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

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
            </div>
            <div style={{ flex: "0 0 260px", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>Subtotal</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.subtotal)}</span></div>
              {mode === "igst" && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>IGST @ {igst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.igstAmt)}</span></div>}
              {mode === "cgst_sgst" && <><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>CGST @ {cgst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.cgstAmt)}</span></div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>SGST @ {sgst || 0}%</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.sgstAmt)}</span></div></>}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800 }}><span>Grand Total</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(totals.grand)}</span></div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
            <ConvertBtn edit={editMode} />
            <button type="button" onClick={() => setShowPreview(true)} style={{ fontSize: 13.5, fontWeight: 800, padding: "12px 18px", borderRadius: 11, border: "1.5px solid #0f2540", background: "var(--surface, #fff)", color: "#0f2540", cursor: "pointer" }}>👁 Preview invoice</button>
            {!allRated && <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>⚠ Add a rate for every line.</span>}
          </div>
        </form>
      </div>

      {showPreview && (
        <BulkInvoicePreview
          bill={bill}
          ship={ship}
          vendorCode={null}
          workOrderNo={null}
          coveredCodes={[chCode]}
          items={serialItems}
          mode={mode}
          igst={Number(igst) || 0}
          cgst={Number(cgst) || 0}
          sgst={Number(sgst) || 0}
          invoiceNo={invLabel}
          invoiceDate={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
