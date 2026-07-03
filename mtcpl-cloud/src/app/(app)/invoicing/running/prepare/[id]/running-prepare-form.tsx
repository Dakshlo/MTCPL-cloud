"use client";

/** Create/edit the RUNNING CHALLAN (Daksh, Jul 2026). Full split: dispatch challan
 *  LEFT (live, reflects transport as you type), item tables (heads, NO rate) +
 *  transport RIGHT. "Create running challan" posts createRunningChallanAction;
 *  "Preview running challan" shows the full challan (client-side, NOT VALID). */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BULK_UNITS } from "@/lib/bulk-items";
import { createRunningChallanAction } from "../../../actions";

type Transport = { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };
type Line = { particulars: string; hsn: string; unit: string; quantity: string };
type Section = { head: string; lines: Line[] };
const blankLine = (): Line => ({ particulars: "", hsn: "", unit: "", quantity: "" });
const blankSection = (): Section => ({ head: "", lines: [blankLine()] });

function buildSrc(dispatchId: string, t: Transport): string {
  const p = new URLSearchParams({ embed: "1", tc: t.company, tph: t.phone, lr: t.lr, veh: t.vehicle, drv: t.driver, drvph: t.driverPhone });
  return `/dispatch/${dispatchId}/print?${p.toString()}`;
}

function CreateBtn({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Making the running challan…" />
      <button type="submit" disabled={pending} style={{ fontSize: 14.5, fontWeight: 800, padding: "12px 22px", borderRadius: 11, border: "none", color: "#fff", background: pending ? "var(--border)" : "#6d28d9", cursor: pending ? "default" : "pointer" }}>
        {pending ? "Saving…" : edit ? "💾 Update running challan →" : "🏃 Create running challan →"}
      </button>
    </>
  );
}

export function RunningPrepareForm({ id, code, temple, editMode, sourceDispatchId, transport, companies, initSections }: {
  id: string; code: string; temple: string; editMode: boolean;
  sourceDispatchId: string | null; transport: Transport; companies: string[];
  initSections: Array<{ head: string; lines: Array<{ particulars: string; hsn: string; unit: string; quantity: string }> }>;
}) {
  const [t, setT] = useState<Transport>(transport);
  const setTf = (k: keyof Transport, v: string) => setT((p) => ({ ...p, [k]: v }));
  const [sections, setSections] = useState<Section[]>(() => (initSections.length ? initSections.map((s) => ({ head: s.head, lines: s.lines.length ? s.lines.map((l) => ({ ...l })) : [blankLine()] })) : [blankSection()]));
  const [showPreview, setShowPreview] = useState(false);

  // Live dispatch-challan preview (debounced).
  const [src, setSrc] = useState(() => (sourceDispatchId ? buildSrc(sourceDispatchId, transport) : ""));
  useEffect(() => {
    if (!sourceDispatchId) return;
    const h = setTimeout(() => setSrc(buildSrc(sourceDispatchId, t)), 400);
    return () => clearTimeout(h);
  }, [t, sourceDispatchId]);

  const setLine = (si: number, li: number, k: keyof Line, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.map((l, j) => (j === li ? { ...l, [k]: v } : l)) } : s)));
  const setHead = (si: number, v: string) => setSections((p) => p.map((s, i) => (i === si ? { ...s, head: v } : s)));
  const addLine = (si: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: [...s.lines, blankLine()] } : s)));
  const removeLine = (si: number, li: number) => setSections((p) => p.map((s, i) => (i === si ? { ...s, lines: s.lines.filter((_, j) => j !== li) } : s)));
  const addTable = () => setSections((p) => [...p, blankSection()]);
  const removeTable = (si: number) => setSections((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== si)));

  const serialItems = useMemo(
    () => sections.flatMap((s, si) => s.lines.filter((l) => l.particulars.trim() || Number(l.quantity)).map((l) => ({ particulars: l.particulars, hsn: l.hsn, unit: l.unit, quantity: Number(l.quantity) || 0, section_index: si, section_head: s.head.trim() || null }))),
    [sections],
  );
  const itemsJson = JSON.stringify(serialItems);
  const hasItems = serialItems.some((it) => it.particulars.trim());

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };
  const field: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 40 }}>
      {/* LEFT — dispatch challan, live. */}
      {sourceDispatchId ? (
        <div style={{ flex: "1 1 520px", minWidth: 360, position: "sticky", top: 10, display: "flex", flexDirection: "column", height: "calc(100vh - 20px)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", marginTop: 44 }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>📋 Dispatch challan — {code}</span>
            <Link href={`/dispatch/${sourceDispatchId}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none", whiteSpace: "nowrap" }}>Open full ↗</Link>
          </div>
          <iframe src={src} title="Dispatch challan" style={{ flex: 1, width: "100%", border: "none", background: "#f0f0f0" }} />
        </div>
      ) : (
        <div style={{ flex: "1 1 400px", minWidth: 340, marginTop: 44 }} className="banner">This challan has no linked dispatch.</div>
      )}

      {/* RIGHT — running-challan form. */}
      <div style={{ flex: "1 1 520px", minWidth: 360, marginTop: 44 }}>
        <Link href="/invoicing/challans" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Challans</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, marginBottom: 2 }}>
          <h1 style={{ margin: 0, fontSize: 21 }}>{editMode ? "Edit running challan" : "Running challan"}</h1>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{code}</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 16px" }}>🏛 {temple} · build the item tables (each with a head), fill transport, then create. <strong>No rate here</strong> — that&apos;s added when you convert it to an invoice. Same CH number.</p>

        <form action={createRunningChallanAction}>
          <input type="hidden" name="challan_id" value={id} />
          <input type="hidden" name="edit_mode" value={editMode ? "1" : ""} />
          <input type="hidden" name="items" value={itemsJson} />

          {/* Item tables */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map((s, si) => (
              <div key={si} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <input value={s.head} onChange={(e) => setHead(si, e.target.value)} placeholder="Table head (e.g. PinkStone)" style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, padding: "3px 4px" }} />
                  {sections.length > 1 && <button type="button" onClick={() => removeTable(si)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✕ Table</button>}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 480 }}>
                    <thead>
                      <tr style={{ background: "var(--surface)" }}>
                        <th style={{ ...cell, width: 24 }}>#</th>
                        <th style={{ ...cell, textAlign: "left" }}>Item / Particulars</th>
                        <th style={{ ...cell, width: 90 }}>HSN <span style={{ fontWeight: 500, color: "var(--muted)" }}>(opt)</span></th>
                        <th style={{ ...cell, width: 92 }}>Unit</th>
                        <th style={{ ...cell, width: 78 }}>Qty</th>
                        <th style={{ ...cell, width: 30 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l, li) => (
                        <tr key={li}>
                          <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>{li + 1}</td>
                          <td style={cell}><input value={l.particulars} onChange={(e) => setLine(si, li, "particulars", e.target.value)} style={inp} placeholder="Description of goods / work" /></td>
                          <td style={cell}><input value={l.hsn} onChange={(e) => setLine(si, li, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                          <td style={cell}>
                            <select value={l.unit} onChange={(e) => setLine(si, li, "unit", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                              <option value="">Unit…</option>
                              {BULK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td style={cell}><input value={l.quantity} onChange={(e) => setLine(si, li, "quantity", e.target.value)} inputMode="decimal" style={num} /></td>
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

          {/* Transport */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)", marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, letterSpacing: "0.04em" }}>🚚 Transportation</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label><span style={lbl}>Transport company</span><input name="transport_company" list="run-companies" value={t.company} onChange={(e) => setTf("company", e.target.value)} style={field} /><datalist id="run-companies">{companies.map((n) => <option key={n} value={n} />)}</datalist></label>
              <label><span style={lbl}>LR no.</span><input name="lr_no" value={t.lr} onChange={(e) => setTf("lr", e.target.value)} style={field} /></label>
              <label><span style={lbl}>Vehicle no.</span><input name="transport_vehicle_no" value={t.vehicle} onChange={(e) => setTf("vehicle", e.target.value)} style={{ ...field, fontFamily: "ui-monospace, monospace" }} /></label>
              <label><span style={lbl}>Transport phone</span><input name="transport_phone" value={t.phone} onChange={(e) => setTf("phone", e.target.value)} style={field} /></label>
              <label><span style={lbl}>Driver name</span><input name="transport_driver_name" value={t.driver} onChange={(e) => setTf("driver", e.target.value)} style={field} /></label>
              <label><span style={lbl}>Driver phone</span><input name="transport_driver_phone" value={t.driverPhone} onChange={(e) => setTf("driverPhone", e.target.value)} style={field} /></label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
            <CreateBtn edit={editMode} />
            <button type="button" onClick={() => setShowPreview(true)} disabled={!hasItems} style={{ fontSize: 13.5, fontWeight: 800, padding: "12px 18px", borderRadius: 11, border: `1.5px solid ${hasItems ? "#6d28d9" : "var(--border)"}`, background: "var(--surface, #fff)", color: hasItems ? "#6d28d9" : "var(--muted)", cursor: hasItems ? "pointer" : "default" }}>👁 Preview running challan</button>
            {!hasItems && <span style={{ fontSize: 12, color: "var(--muted)" }}>Add at least one line item.</span>}
          </div>
        </form>
      </div>

      {showPreview && <RunningChallanPreview code={code} temple={temple} sections={sections} transport={t} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

/** Client-side preview of the full running challan (NOT VALID watermark). */
function RunningChallanPreview({ code, temple, sections, transport, onClose }: { code: string; temple: string; sections: Section[]; transport: Transport; onClose: () => void }) {
  const pcell: React.CSSProperties = { padding: "4px 7px", border: "1px solid #e2e7ee", fontWeight: 700, color: "#1a1a1a", fontSize: 11 };
  const ph: React.CSSProperties = { ...pcell, background: "#eef2f7", fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", color: "#444" };
  const filled = sections.map((s) => ({ head: s.head, lines: s.lines.filter((l) => l.particulars.trim() || Number(l.quantity)) })).filter((s) => s.lines.length);
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "start center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)", background: "#fff", color: "#1a1a1a", borderRadius: 12, padding: "18px 22px 22px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", alignContent: "space-evenly", justifyItems: "center", padding: "26px 0" }}>
          {Array.from({ length: 24 }).map((_, i) => <span key={i} style={{ transform: "rotate(-30deg)", whiteSpace: "nowrap", font: "800 15px/1 Arial, sans-serif", color: "#d40000", opacity: 0.16 }}>NOT VALID CHALLAN</span>)}
        </div>
        <div style={{ position: "relative", zIndex: 10 }}>
          <div style={{ textAlign: "center", marginBottom: 7 }}><span style={{ display: "inline-block", fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: "#fff", background: "#5b21b6", borderRadius: 6, padding: "4px 20px" }}>RUNNING CHALLAN</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, borderBottom: "2.5px double #5b21b6", paddingBottom: 6, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2540" }}>MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
              <div style={{ fontSize: 10, color: "#666" }}>GSTIN: 08AAFCM15Q1ZA · ☎ 80941 56965 · temple@mtcpl.co</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{code}</div>
              <div style={{ fontSize: 11, color: "#555" }}>🏛 {temple}</div>
            </div>
          </div>
          {(transport.company || transport.vehicle || transport.driver || transport.lr) && (
            <div style={{ fontSize: 10.5, color: "#0f2540", fontWeight: 700, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>
              🚚 {[transport.company, transport.lr ? `LR ${transport.lr}` : "", transport.vehicle, transport.driver].filter(Boolean).join("  ·  ")}
            </div>
          )}
          {filled.length === 0 ? <p style={{ color: "#888", fontSize: 11 }}>No line items yet.</p> : filled.map((s, gi) => (
            <div key={gi} style={{ marginBottom: 8 }}>
              {(filled.length > 1 || s.head.trim()) && <div style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#5b21b6", borderRadius: "5px 5px 0 0", padding: "4px 9px" }}>{s.head.trim() || `Table ${gi + 1}`}</div>}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={ph}>#</th><th style={{ ...ph, textAlign: "left" }}>Item / Particulars</th><th style={ph}>HSN</th><th style={ph}>Unit</th><th style={{ ...ph, textAlign: "right" }}>Qty</th></tr></thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={pcell}>{i + 1}</td>
                      <td style={pcell}>{l.particulars || "-"}</td>
                      <td style={{ ...pcell, fontFamily: "ui-monospace, monospace" }}>{l.hsn || "-"}</td>
                      <td style={pcell}>{l.unit || "-"}</td>
                      <td style={{ ...pcell, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{l.quantity || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13.5, padding: "10px 20px", fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 10, cursor: "pointer" }}>Close preview</button>
          </div>
        </div>
      </div>
    </div>
  );
}
