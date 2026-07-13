"use client";

/**
 * Create a work order (bulk) invoice (Daksh, Jul 2026 rework). Full-screen split:
 * LEFT shows the delivery challans you tick (iframes, to verify while billing);
 * RIGHT is the form — pick temple, TICK ≥1 challan (mandatory, bigger cards), then
 * build the line items as one or MORE tables, each with its own head (e.g.
 * "PinkStone") — ＋ Add line inside a table, ＋ Add table for another. Unit is a
 * CFT/SFT/NOS dropdown; every field is required except HSN. Live totals + 👁
 * preview (NOT-VALID watermark). Posts createBulkInvoiceAction → owner approval.
 */

import { useMemo, useState } from "react";
import { createBulkInvoiceAction } from "../../actions";
import { applyDiscount, computeGroupedGstTotals, discountLabel, gstGroupLabel, rupee, type GstMode } from "@/lib/challan-pricing";
import { BULK_UNITS } from "@/lib/bulk-items";
import { DiscountControl, type DiscountModeUi } from "../../_ui/discount-control";
import { BulkInvoicePreview, type PreviewParty } from "./bulk-invoice-preview";

export type TempleData = {
  temple: string;
  gst: { mode: GstMode; igst: number; cgst: number; sgst: number };
  challans: { id: string; code: string; date: string; dispatchId: string | null }[];
  bill: PreviewParty | null;
  ship: PreviewParty | null;
  vendorCode: string | null;
  workOrderNo: string | null;
};
type Line = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };
// Mig 199 — every table carries ITS OWN GST slab % (mandatory when GST is on).
type Section = { head: string; gst: string; lines: Line[] };

const blankLine = (): Line => ({ particulars: "", hsn: "", unit: "", quantity: "", rate: "" });
const blankSection = (gst = "18"): Section => ({ head: "", gst, lines: [blankLine()] });
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

export function BulkInvoiceForm({ temples, invPrefix, autoNum }: { temples: TempleData[]; invPrefix: string; autoNum: string }) {
  const [temple, setTemple] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [sections, setSections] = useState<Section[]>([blankSection()]);
  const [mode, setMode] = useState<GstMode>(null);
  // The temple's default slab — seeds each NEW table's GST %.
  const [defaultPct, setDefaultPct] = useState("18");
  // Mig 200 — discount on the final amount. Default OFF.
  const [discMode, setDiscMode] = useState<DiscountModeUi>("off");
  const [discValue, setDiscValue] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const cur = temples.find((t) => t.temple === temple) ?? null;

  function pickTemple(name: string) {
    setTemple(name);
    setChecked({});
    const t = temples.find((x) => x.temple === name);
    if (t) {
      setMode(t.gst.mode);
      const pct = t.gst.mode === "igst" ? t.gst.igst : t.gst.mode === "cgst_sgst" ? t.gst.cgst + t.gst.sgst : 18;
      const pctStr = String(pct || 18);
      setDefaultPct(pctStr);
      // Seed every table's slab with the temple default (still editable per table).
      setSections((p) => p.map((s) => ({ ...s, gst: pctStr })));
    }
  }

  const amountOf = (l: Line) => (Number(l.quantity) || 0) * (Number(l.rate) || 0);
  const setLine = (si: number, li: number, k: keyof Line, v: string) =>
    setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.map((l, j) => (j === li ? { ...l, [k]: v } : l)) } : s)));
  const setHead = (si: number, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, head: v } : s)));
  const setGst = (si: number, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, gst: v.replace(/[^0-9.]/g, "") } : s)));
  const addLine = (si: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: [...s.lines, blankLine()] } : s)));
  const removeLine = (si: number, li: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.filter((_, j) => j !== li) } : s)));
  const addTable = () => setSections((p) => [...p, blankSection(defaultPct)]);
  const removeTable = (si: number) => setSections((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== si)));

  // Flat serialized items (carry the table index + head + slab) for submit / preview.
  const serialItems = useMemo(
    () => sections.flatMap((s, si) =>
      s.lines
        .filter((l) => l.particulars.trim() || Number(l.quantity) || Number(l.rate))
        .map((l) => ({ particulars: l.particulars, hsn: l.hsn, unit: l.unit, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, amount: amountOf(l), section_index: si, section_head: s.head.trim() || null, section_gst: mode ? (s.gst.trim() === "" ? null : Number(s.gst) || 0) : null })),
    ),
    [sections, mode],
  );
  const totals = useMemo(
    () => computeGroupedGstTotals(serialItems.map((i) => ({ amount: i.amount, gstPercent: i.section_gst })), { mode, igst: 0, cgst: 0, sgst: 0 }),
    [serialItems, mode],
  );
  const disc = applyDiscount(totals.grand, discMode === "off" ? null : discMode, Number(discValue) || 0);

  const challanIds = Object.keys(checked).filter((k) => checked[k]);
  const selectedChallans = (cur?.challans ?? []).filter((c) => checked[c.id]);
  const coveredCodes = selectedChallans.map((c) => c.code);
  const itemsJson = JSON.stringify(serialItems);

  // Validation — every STARTED line must be complete (all but HSN).
  const startedLines = sections.flatMap((s) => s.lines).filter((l) => l.particulars.trim() || l.quantity || l.rate || l.unit);
  const isComplete = (l: Line) => !!l.particulars.trim() && !!l.unit && Number(l.quantity) > 0 && Number(l.rate) > 0;
  const incompleteLines = startedLines.filter((l) => !isComplete(l)).length;
  const completeCount = startedLines.filter(isComplete).length;
  // GST slab is MANDATORY per table when GST is on (mig 199).
  const sectionStarted = (s: Section) => s.lines.some((l) => l.particulars.trim() || l.quantity || l.rate || l.unit);
  const missingGstTables = mode ? sections.filter((s) => sectionStarted(s) && s.gst.trim() === "").length : 0;
  const canSubmit = !!temple && challanIds.length >= 1 && completeCount >= 1 && incompleteLines === 0 && missingGstTables === 0;

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  return (
    <form action={createBulkInvoiceAction}>
      <input type="hidden" name="temple" value={temple} />
      <input type="hidden" name="challan_ids" value={JSON.stringify(challanIds)} />
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="gst_mode" value={mode ?? ""} />
      <input type="hidden" name="discount_mode" value={discMode === "off" ? "" : discMode} />
      <input type="hidden" name="discount_value" value={discMode === "off" ? "" : discValue} />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* LEFT — the ticked challans, to verify while billing. */}
        <div style={{ flex: "1 1 500px", minWidth: 340, position: "sticky", top: 10, height: "calc(100vh - 24px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>📋 Challans on this invoice {selectedChallans.length > 0 && <span style={{ color: "var(--text)" }}>· {selectedChallans.length}</span>}</div>
          {selectedChallans.length === 0 ? (
            <div style={{ flex: 1, border: "1px dashed var(--border)", borderRadius: 12, background: "var(--surface)", display: "grid", placeItems: "center", padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              Tick a challan on the right — it shows here so you can verify quantities while you bill.
            </div>
          ) : (
            selectedChallans.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", flexShrink: 0 }}>
                <div style={{ padding: "7px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--bg)" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{c.code}</span>
                  {c.dispatchId && <a href={`/dispatch/${c.dispatchId}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}>Open ↗</a>}
                </div>
                {c.dispatchId
                  ? <iframe src={`/dispatch/${c.dispatchId}/print?embed=1`} title={c.code} style={{ width: "100%", height: 560, border: "none", background: "#f0f0f0" }} />
                  : <div style={{ padding: 18, fontSize: 12, color: "var(--muted)" }}>No linked dispatch challan.</div>}
              </div>
            ))
          )}
        </div>

        {/* RIGHT — the form. */}
        <div style={{ flex: "1 1 540px", minWidth: 360 }}>
          {/* 1 — Temple */}
          <Section step={1} title="Client (temple)" subtitle="Which temple is this invoice billed to?">
            <label className="stack" style={{ maxWidth: 460 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Temple</span>
              <select value={temple} onChange={(e) => pickTemple(e.target.value)} required style={FIELD}>
                <option value="">Select a temple…</option>
                {temples.map((t) => <option key={t.temple} value={t.temple}>{t.temple} ({t.challans.length} work order challan{t.challans.length !== 1 ? "s" : ""})</option>)}
              </select>
            </label>
            {cur?.bill && (cur.bill.gstin || cur.bill.address) && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                <strong style={{ color: "var(--text)" }}>{cur.bill.name}</strong>
                {cur.bill.address ? ` · ${cur.bill.address}` : ""}{cur.bill.gstin ? ` · GSTIN ${cur.bill.gstin}` : ""}
              </div>
            )}
          </Section>

          {/* 2 — Challans covered (mandatory ≥1, bigger/bolder) */}
          {cur && (
            <Section step={2} title="Challans covered by this bill" subtitle="Tick at least one — it appears on the left. The line items below are what gets billed.">
              {cur.challans.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No work order challans for this temple.</div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
                    {cur.challans.map((c) => {
                      const on = !!checked[c.id];
                      return (
                        <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, border: `2px solid ${on ? "#15803d" : "var(--border)"}`, borderRadius: 11, padding: "12px 14px", cursor: "pointer", background: on ? "rgba(22,101,52,0.07)" : "var(--bg)", transition: "border-color .12s, background .12s" }}>
                          <input type="checkbox" checked={on} onChange={(e) => setChecked((p) => ({ ...p, [c.id]: e.target.checked }))} style={{ width: 20, height: 20, accentColor: "#15803d", flexShrink: 0 }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 16, display: "block", color: "var(--text)", letterSpacing: "-0.01em" }}>{c.code}</span>
                            <span className="muted" style={{ fontSize: 11.5 }}>{new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 800, color: challanIds.length ? "#15803d" : "#b45309" }}>
                    {challanIds.length ? `✓ ${challanIds.length} challan${challanIds.length !== 1 ? "s" : ""} selected` : "⚠ Select at least one challan"}
                  </div>
                </>
              )}
            </Section>
          )}

          {/* 3 — Line items (one or more tables, each with a head) */}
          <Section step={3} title="Line items" subtitle="Build one or more tables. Give each a head (e.g. PinkStone). Every field is required except HSN.">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {sections.map((s, si) => (
                <div key={si} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                    <input value={s.head} onChange={(e) => setHead(si, e.target.value)} placeholder={`Table head (e.g. PinkStone)`} style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, padding: "3px 4px", textTransform: "uppercase" }} />
                    {mode && (
                      <label title={`This table's GST slab — mandatory. ${mode === "cgst_sgst" ? "Splits half CGST / half SGST." : "Charged as IGST."}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: s.gst.trim() === "" ? "#dc2626" : "var(--muted)", whiteSpace: "nowrap" }}>
                        GST %
                        <input value={s.gst} onChange={(e) => setGst(si, e.target.value)} inputMode="decimal" placeholder="req." style={{ width: 58, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 800, padding: "4px 7px", borderRadius: 7, border: `1.5px solid ${s.gst.trim() === "" ? "#dc2626" : "var(--gold-dark)"}`, background: "var(--surface)", color: "var(--text)" }} />
                      </label>
                    )}
                    {sections.length > 1 && <button type="button" onClick={() => removeTable(si)} title="Remove this table" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✕ Table</button>}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
                      <thead>
                        <tr style={{ background: "var(--surface)" }}>
                          <th style={{ ...cell, width: 24 }}>#</th>
                          <th style={{ ...cell, textAlign: "left" }}>Item / Particulars</th>
                          <th style={{ ...cell, width: 90 }}>HSN <span style={{ fontWeight: 500, color: "var(--muted)" }}>(opt)</span></th>
                          <th style={{ ...cell, width: 92 }}>Unit</th>
                          <th style={{ ...cell, width: 78 }}>Qty</th>
                          <th style={{ ...cell, width: 92 }}>Rate</th>
                          <th style={{ ...cell, width: 104, textAlign: "right" }}>Amount</th>
                          <th style={{ ...cell, width: 30 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map((l, li) => {
                          const started = !!(l.particulars.trim() || l.quantity || l.rate || l.unit);
                          const bad = started && !isComplete(l);
                          return (
                            <tr key={li} style={bad ? { background: "rgba(220,38,38,0.05)" } : undefined}>
                              <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>{li + 1}</td>
                              <td style={cell}><input value={l.particulars} onChange={(e) => setLine(si, li, "particulars", e.target.value)} style={{ ...inp, textTransform: "uppercase" }} placeholder="Description of goods / work" /></td>
                              <td style={cell}><input value={l.hsn} onChange={(e) => setLine(si, li, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                              <td style={cell}>
                                <select value={l.unit} onChange={(e) => setLine(si, li, "unit", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                                  <option value="">Unit…</option>
                                  {BULK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </td>
                              <td style={cell}><input value={l.quantity} onChange={(e) => setLine(si, li, "quantity", e.target.value)} inputMode="decimal" style={num} /></td>
                              <td style={cell}><input value={l.rate} onChange={(e) => setLine(si, li, "rate", e.target.value)} inputMode="decimal" style={num} /></td>
                              <td style={{ ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{rupee(amountOf(l))}</td>
                              <td style={{ ...cell, textAlign: "center" }}>
                                {s.lines.length > 1 && <button type="button" onClick={() => removeLine(si, li)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800 }}>✕</button>}
                              </td>
                            </tr>
                          );
                        })}
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
            {incompleteLines > 0 && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "#b45309" }}>⚠ {incompleteLines} line{incompleteLines !== 1 ? "s" : ""} missing a required field (Particulars, Unit, Qty, Rate).</div>}
          </Section>

          {/* 4 — GST + totals */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch", marginBottom: 16 }}>
            <div style={{ flex: "1 1 300px" }}>
              <Section step={4} title="GST" subtitle="Mode applies to the whole bill; the % is set PER TABLE (each table header above).">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {([["none", "No GST"], ["igst", "IGST"], ["cgst_sgst", "CGST + SGST"]] as const).map(([val, label]) => {
                    const on = (mode ?? "none") === val;
                    return <button key={val} type="button" onClick={() => setMode(val === "none" ? null : (val as GstMode))} style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--bg)", color: on ? "#fff" : "var(--text)" }}>{label}</button>;
                  })}
                </div>
                {mode && (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                    Each table has its own <strong>GST %</strong> box in its header — mandatory. Tables can carry different slabs (e.g. 18% + 5%) on one bill{mode === "cgst_sgst" ? "; a slab splits half CGST / half SGST" : ""}.
                  </div>
                )}
                <DiscountControl mode={discMode} value={discValue} onMode={setDiscMode} onValue={setDiscValue} />
                <div style={{ marginTop: 14 }}>
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1.5px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "7px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5 }}>
                    {invPrefix}{autoNum}
                    <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", fontFamily: "inherit" }}>🔒 AUTO</span>
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 5 }}>Assigned automatically — numbers can&apos;t be edited.</span>
                </div>
              </Section>
            </div>
            <div style={{ flex: "0 0 300px" }}>
              <div style={{ ...CARD, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <Row label="Subtotal" value={rupee(totals.subtotal)} />
                {totals.groups.map((g, i) => (
                  <Row key={i} label={`${gstGroupLabel(mode, g)}${totals.multi ? ` on ${rupee(g.taxable)}` : ""}`} value={rupee(g.taxAmt)} />
                ))}
                {disc.amt > 0 ? (
                  <>
                    <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} /></div>
                    <Row label={discountLabel(disc)} value={`−${rupee(disc.amt)}`} />
                    <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Amount Payable" value={rupee(disc.payable)} bold /></div>
                  </>
                ) : (
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} bold /></div>
                )}
              </div>
            </div>
          </div>

          {/* CTA row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setShowPreview(true)} disabled={!temple} style={{ fontSize: 13.5, padding: "12px 20px", fontWeight: 800, color: temple ? "#0f2540" : "var(--muted)", background: "var(--surface, #fff)", border: `1.5px solid ${temple ? "#0f2540" : "var(--border)"}`, borderRadius: 11, cursor: temple ? "pointer" : "default" }}>
              👁 Preview invoice
            </button>
            <button type="submit" disabled={!canSubmit} style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: canSubmit ? "#0f172a" : "var(--border)", border: "none", borderRadius: 11, cursor: canSubmit ? "pointer" : "default" }}>
              🧾 Create work order invoice → owner approval
            </button>
            {!canSubmit && <span style={{ fontSize: 12, color: "var(--muted)" }}>{!temple ? "Pick a temple." : challanIds.length < 1 ? "Tick at least one challan." : incompleteLines > 0 ? "Complete every line (all but HSN)." : missingGstTables > 0 ? `Set the GST % on ${missingGstTables === 1 ? "the table missing it" : `all ${missingGstTables} tables missing it`}.` : "Add at least one line item."}</span>}
          </div>
        </div>
      </div>

      {showPreview && (
        <BulkInvoicePreview
          bill={cur?.bill ?? null}
          ship={cur?.ship ?? null}
          vendorCode={cur?.vendorCode ?? null}
          workOrderNo={cur?.workOrderNo ?? null}
          coveredCodes={coveredCodes}
          items={serialItems}
          mode={mode}
          igst={0}
          cgst={0}
          sgst={0}
          discountMode={discMode === "off" ? null : discMode}
          discountValue={Number(discValue) || 0}
          invoiceNo={`${invPrefix}${autoNum}`}
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
