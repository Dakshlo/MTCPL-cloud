"use client";

/**
 * "Other Sales" (mig 176 + 183) — client UI, TWO-STEP like running bills.
 *   1. Create a CHALLAN: client + sectioned line items (table heads), NO rate.
 *      Numbered CH-<FY>-n on the shared series. Preview = plain delivery challan.
 *   2. Convert to an invoice on a full-screen page (rate per line + GST) → the
 *      locked INV-<FY>-n on the shared series.
 * The challan list has a Recent ⇄ Party-wise toggle (default Recent). Clients
 * reuse invoice_parties (billing + shipping + GST).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createOtherChallanAction, updateOtherChallanAction, cancelOtherChallanAction } from "./actions";
import { upsertInvoicePartyAction } from "../actions";
import { rupee, type GstMode } from "@/lib/challan-pricing";
import { BULK_UNITS } from "@/lib/bulk-items";
import { Combobox, CATEGORY_HINTS } from "../_ui/combobox";

export type Party = {
  id: string; name: string; category: string | null; gstin: string | null; pan: string | null;
  address: string | null; city: string | null; state: string | null; state_code: string | null; phone: string | null; email: string | null;
  ship_name: string | null; ship_address: string | null; ship_city: string | null; ship_state: string | null; ship_state_code: string | null; ship_gstin: string | null; ship_phone: string | null;
  gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null;
};
export type OtherItem = { particulars: string; hsn: string; unit: string; quantity: number; rate: number; amount: number; sectionIndex: number; sectionHead: string | null };
export type OtherTransport = { company: string | null; phone: string | null; lr: string | null; vehicle: string | null; driver: string | null; driverPhone: string | null };
export type OtherChallan = {
  id: string; code: string; date: string; partyId: string; partyName: string; category: string | null;
  notes: string | null; items: OtherItem[]; converted: boolean; invoiceCode: string | null; total: number;
  transport?: OtherTransport;
};

// Form-state shape for the transport strip (all strings while editing).
type TransportForm = { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };
const emptyTransport = (): TransportForm => ({ company: "", phone: "", lr: "", vehicle: "", driver: "", driverPhone: "" });

type Line = { particulars: string; hsn: string; unit: string; quantity: string };
type Section = { head: string; lines: Line[] };
const blankLine = (): Line => ({ particulars: "", hsn: "", unit: "", quantity: "" });
const blankSection = (): Section => ({ head: "", lines: [blankLine()] });
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
// Other Sales bills a wider range of goods than dispatch — allow weight/volume
// units on top of the standard CFT / SFT / NOS (Daksh).
const OTHER_UNITS: string[] = [...BULK_UNITS, "Tonnes", "Cubic meter"];

function toSections(items: OtherItem[]): Section[] {
  if (!items.length) return [blankSection()];
  const map = new Map<number, Section>();
  for (const it of items) {
    const si = it.sectionIndex ?? 0;
    if (!map.has(si)) map.set(si, { head: it.sectionHead ?? "", lines: [] });
    map.get(si)!.lines.push({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: it.quantity ? String(it.quantity) : "" });
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => ({ head: s.head, lines: s.lines.length ? s.lines : [blankLine()] }));
}

export function OtherSalesClient({
  clients, challans, chPrefix, chAuto, preselectId, openNew, needsMigration,
}: {
  clients: Party[]; challans: OtherChallan[];
  chPrefix: string; chAuto: string;
  preselectId?: string; openNew?: boolean; needsMigration?: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(!!openNew);
  const [editId, setEditId] = useState<string | null>(null);
  const [party, setParty] = useState(preselectId ?? "");
  const [date, setDate] = useState(todayIST());
  const [sections, setSections] = useState<Section[]>([blankSection()]);
  const [notes, setNotes] = useState("");
  const [transport, setTransport] = useState<TransportForm>(emptyTransport());
  const [clientModal, setClientModal] = useState(false);
  const [pendingClient, setPendingClient] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [view, setView] = useState<"recent" | "party">("recent");

  useEffect(() => {
    if (!pendingClient) return;
    const found = clients.find((c) => c.name.trim().toLowerCase() === pendingClient.trim().toLowerCase());
    if (found) { setParty(found.id); setPendingClient(null); setFormOpen(true); }
  }, [clients, pendingClient]);

  const cur = clients.find((c) => c.id === party) ?? null;

  function resetForm() {
    setEditId(null); setParty(""); setDate(todayIST()); setSections([blankSection()]); setNotes(""); setTransport(emptyTransport());
  }
  function startNew() { resetForm(); if (preselectId) setParty(preselectId); setFormOpen(true); }
  function startEdit(ch: OtherChallan) {
    setEditId(ch.id); setParty(ch.partyId); setDate(ch.date); setSections(toSections(ch.items)); setNotes(ch.notes ?? "");
    const t = ch.transport;
    setTransport({ company: t?.company ?? "", phone: t?.phone ?? "", lr: t?.lr ?? "", vehicle: t?.vehicle ?? "", driver: t?.driver ?? "", driverPhone: t?.driverPhone ?? "" });
    setFormOpen(true);
  }
  const setTf = (k: keyof TransportForm, v: string) => setTransport((p) => ({ ...p, [k]: v }));

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
  const canSubmit = !!party && hasItems;

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  if (needsMigration) {
    return (
      <div className="banner" style={{ marginTop: 14 }}>
        ⚠ Run migration <strong>176_other_sales.sql</strong> (and <strong>183_other_sales_sections.sql</strong>) on Supabase to enable Other Sales.
      </div>
    );
  }

  // Recency order: server hands them newest-first; keep as-is for Recent, group for Party-wise.
  const partyGroups = useMemo(() => {
    const m = new Map<string, OtherChallan[]>();
    for (const c of challans) { const a = m.get(c.partyName) ?? []; a.push(c); m.set(c.partyName, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [challans]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!formOpen && (
        <div>
          <button type="button" onClick={startNew} style={btnPrimary}>＋ New challan</button>
        </div>
      )}

      {formOpen && (
        <form action={editId ? updateOtherChallanAction : createOtherChallanAction} style={CARD}>
          {editId && <input type="hidden" name="other_challan_id" value={editId} />}
          <input type="hidden" name="items" value={itemsJson} />
          <input type="hidden" name="challan_date" value={date} />
          <input type="hidden" name="notes" value={notes} />
          <input type="hidden" name="party_id" value={party} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{editId ? "Edit challan" : "New challan"} <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>· {editId ? "" : `${chPrefix}${chAuto}`}</span></h2>
            <button type="button" onClick={() => { setFormOpen(false); resetForm(); }} style={btnGhost}>Close</button>
          </div>

          {/* Client + date */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <label className="stack" style={{ flex: "1 1 320px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Client</span>
              <ClientPicker clients={clients} value={party} onChange={setParty} />
            </label>
            <button type="button" onClick={() => setClientModal(true)} style={btnGhost}>＋ New client</button>
            <label className="stack" style={{ flex: "0 0 160px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Challan date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={FIELD} />
            </label>
          </div>
          {cur && (cur.gstin || cur.address || cur.ship_address) && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)", marginBottom: 12 }}>
              <div><strong style={{ color: "var(--text)" }}>Bill to:</strong> {[cur.address, cur.city, cur.state].filter(Boolean).join(", ") || "—"}{cur.gstin ? ` · GSTIN ${cur.gstin}` : ""}</div>
              <div><strong style={{ color: "var(--text)" }}>Ship to:</strong> {[cur.ship_name, cur.ship_address, cur.ship_city].filter(Boolean).join(", ") || "same as billing"}</div>
            </div>
          )}

          {/* Transportation (mig 206) — prints on the challan AND its invoice. */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", background: "var(--bg)", marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 10 }}>🚚 Transportation <span style={{ fontWeight: 600, textTransform: "none" }}>(optional — prints on the challan &amp; invoice)</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <label className="stack"><span style={tlbl}>Transport company</span><input name="transport_company" value={transport.company} onChange={(e) => setTf("company", e.target.value)} autoComplete="off" style={{ ...FIELD, textTransform: "uppercase" }} /></label>
              <label className="stack"><span style={tlbl}>Company phone</span><input name="transport_phone" value={transport.phone} onChange={(e) => setTf("phone", e.target.value)} inputMode="tel" autoComplete="off" style={FIELD} /></label>
              <label className="stack"><span style={tlbl}>LR no.</span><input name="lr_no" value={transport.lr} onChange={(e) => setTf("lr", e.target.value)} autoComplete="off" style={{ ...FIELD, textTransform: "uppercase" }} /></label>
              <label className="stack"><span style={tlbl}>Vehicle no.</span><input name="transport_vehicle_no" value={transport.vehicle} onChange={(e) => setTf("vehicle", e.target.value)} autoComplete="off" style={{ ...FIELD, textTransform: "uppercase" }} /></label>
              <label className="stack"><span style={tlbl}>Driver name</span><input name="transport_driver_name" value={transport.driver} onChange={(e) => setTf("driver", e.target.value)} autoComplete="off" style={{ ...FIELD, textTransform: "uppercase" }} /></label>
              <label className="stack"><span style={tlbl}>Driver phone</span><input name="transport_driver_phone" value={transport.driverPhone} onChange={(e) => setTf("driverPhone", e.target.value)} inputMode="tel" autoComplete="off" style={FIELD} /></label>
            </div>
          </div>

          {/* Sectioned line items (table heads), NO rate — it's a challan. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map((s, si) => (
              <div key={si} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <input value={s.head} onChange={(e) => setHead(si, e.target.value)} placeholder="Table head (e.g. Marble, Granite)" style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, padding: "3px 4px", textTransform: "uppercase" }} />
                  {sections.length > 1 && <button type="button" onClick={() => removeTable(si)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✕ Table</button>}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
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
                          <td style={cell}><input value={l.particulars} onChange={(e) => setLine(si, li, "particulars", e.target.value)} style={{ ...inp, textTransform: "uppercase" }} placeholder="Description of goods" /></td>
                          <td style={cell}><input value={l.hsn} onChange={(e) => setLine(si, li, "hsn", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></td>
                          <td style={cell}>
                            <select value={l.unit} onChange={(e) => setLine(si, li, "unit", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                              <option value="">Unit…</option>
                              {OTHER_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                              {l.unit && !OTHER_UNITS.includes(l.unit) && <option value={l.unit}>{l.unit}</option>}
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
                  <button type="button" onClick={() => addLine(si)} style={{ ...btnSmall }}>＋ Add line</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addTable} style={{ marginTop: 12, fontSize: 12.5, fontWeight: 800, padding: "9px 15px", borderRadius: 9, border: "1.5px dashed var(--gold-dark)", background: "rgba(180,83,9,0.06)", color: "var(--gold-dark)", cursor: "pointer" }}>＋ Add table (new head)</button>

          <label className="stack" style={{ marginTop: 14, maxWidth: 520 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Notes (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...FIELD, resize: "vertical" }} /></label>

          <p style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 0" }}>💡 No rate here — that&apos;s added when you convert this challan to an invoice. Same CH number.</p>
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setPreview(true)} disabled={!party || !hasItems} style={{ ...btnGhost, opacity: (party && hasItems) ? 1 : 0.5, cursor: (party && hasItems) ? "pointer" : "default" }}>👁 Preview challan</button>
            <button type="submit" disabled={!canSubmit} style={{ ...btnPrimary, background: canSubmit ? "#0f172a" : "var(--border)", cursor: canSubmit ? "pointer" : "default" }}>
              {editId ? "💾 Save challan" : "🧾 Create challan"}
            </button>
            {!canSubmit && <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick a client and add at least one line item.</span>}
          </div>
        </form>
      )}

      {/* Challan list — Recent / Party-wise toggle (default Recent). */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "6px 0 10px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Challans &amp; invoices · {challans.length}</div>
          <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button type="button" onClick={() => setView("recent")} style={seg(view === "recent")}>🕑 Recent</button>
            <button type="button" onClick={() => setView("party")} style={seg(view === "party")}>👥 Party-wise</button>
          </div>
        </div>

        {challans.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, border: "1px dashed var(--border)", borderRadius: 10, padding: "18px", textAlign: "center" }}>No challans yet. Create one above.</div>
        ) : view === "recent" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {challans.map((ch) => <ChallanCard key={ch.id} ch={ch} onEdit={() => startEdit(ch)} />)}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {partyGroups.map(([name, rows]) => (
              <div key={name}>
                <div style={{ fontSize: 13.5, fontWeight: 800, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>🏢 {name} <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>· {rows.length}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                  {rows.map((ch) => <ChallanCard key={ch.id} ch={ch} onEdit={() => startEdit(ch)} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {clientModal && <NewClientModal onClose={() => setClientModal(false)} onSaved={(name) => { setClientModal(false); setPendingClient(name); router.refresh(); }} />}
      {preview && cur && (
        <OtherChallanPreview
          client={cur}
          date={date}
          docCode={editId ? "DRAFT" : `${chPrefix}${chAuto}`}
          sections={sections}
          transport={transport}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}

function ChallanCard({ ch, onEdit }: { ch: OtherChallan; onEdit?: () => void }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${ch.converted ? "#15803d" : "#7C3AED"}`, borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>{ch.converted ? ch.invoiceCode ?? ch.code : ch.code}</span>
        {ch.converted
          ? <span style={{ fontSize: 10, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "2px 9px" }}>✓ INVOICED</span>
          : <span style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.12)", borderRadius: 999, padding: "2px 9px" }}>CHALLAN</span>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>🏢 {ch.partyName}{ch.category ? <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.1)", borderRadius: 6, padding: "1px 7px" }}>{ch.category}</span> : null}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📅 {new Date(`${ch.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })} · {ch.items.length} item{ch.items.length !== 1 ? "s" : ""}{ch.converted ? <> · <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{rupee(ch.total)}</strong></> : null}</div>
      {ch.converted && <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>Against challan {ch.code}</div>}
      <div style={{ marginTop: 2, display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Link href={`/invoicing/other/${ch.id}/print`} target="_blank" rel="noopener noreferrer" style={btnLink}>🖨 {ch.converted ? "Invoice" : "Challan"}</Link>
        {!ch.converted && onEdit && <button type="button" onClick={onEdit} style={btnSmall}>✎ Edit</button>}
        {!ch.converted
          ? <Link href={`/invoicing/other/${ch.id}/invoice`} style={{ ...btnSmall, textDecoration: "none", color: "#fff", background: "var(--gold)", border: "1px solid var(--gold-dark)" }}>🧾 Convert to invoice</Link>
          : <Link href={`/invoicing/other/${ch.id}/invoice`} style={{ ...btnSmall, textDecoration: "none" }}>✎ Edit invoice</Link>}
        {!ch.converted && (
          <form action={cancelOtherChallanAction} onSubmit={(e) => { if (!confirm("Cancel this challan?")) e.preventDefault(); }}>
            <input type="hidden" name="other_challan_id" value={ch.id} />
            <button type="submit" style={{ ...btnSmall, color: "#b91c1c" }}>✕ Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Client-side preview of the plain delivery challan (NOT VALID watermark). */
function OtherChallanPreview({ client, date, docCode, sections, transport, onClose }: {
  client: Party; date: string; docCode: string; sections: Section[]; transport: TransportForm; onClose: () => void;
}) {
  const hasT = transport.company || transport.lr || transport.vehicle || transport.driver;
  const filled = sections.map((s) => ({ head: s.head, lines: s.lines.filter((l) => l.particulars.trim() || Number(l.quantity)) })).filter((s) => s.lines.length);
  const shipName = (client.ship_name ?? "").trim() || client.name;
  const pcell: React.CSSProperties = { padding: "4px 7px", border: "1px solid #e2e7ee", fontWeight: 700, color: "#1a1a1a", fontSize: 11 };
  const ph: React.CSSProperties = { ...pcell, background: "#f3efe7", fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", color: "#444", border: "1px solid #d8d2c4" };
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "start center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(780px, 100%)", background: "#fff", color: "#1a1a1a", borderRadius: 12, padding: "18px 22px 22px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", alignContent: "space-evenly", justifyItems: "center", padding: "26px 0" }}>
          {Array.from({ length: 24 }).map((_, i) => <span key={i} style={{ transform: "rotate(-30deg)", whiteSpace: "nowrap", font: "800 15px/1 Arial, sans-serif", color: "#d40000", opacity: 0.16 }}>NOT VALID CHALLAN</span>)}
        </div>
        <div style={{ position: "relative", zIndex: 10 }}>
          <div style={{ textAlign: "center", marginBottom: 7 }}><span style={{ display: "inline-block", fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", color: "#fff", background: "#0f2540", borderRadius: 6, padding: "4px 20px", textTransform: "uppercase" }}>Challan</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, borderBottom: "2.5px double #1e3a5f", paddingBottom: 6, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2540" }}>MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
              <div style={{ fontSize: 10, color: "#666" }}>GSTIN: 08AAFCM15Q1ZA · ☎ 759 759 1188 · temple@mtcpl.co</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{docCode}</div>
              <div style={{ fontSize: 11, color: "#555" }}>{new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
            <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "7px 9px", background: "#f7fafc" }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "#888" }}>Bill To</div>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{client.name}</div>
              {client.address && <div style={{ fontSize: 11.5, color: "#333" }}>{client.address}</div>}
              {(client.city || client.state) && <div style={{ fontSize: 11.5, color: "#333" }}>{[client.city, client.state].filter(Boolean).join(", ")}</div>}
              {client.gstin && <div style={{ fontSize: 10.5, color: "#555", fontFamily: "ui-monospace, monospace" }}>GSTIN: {client.gstin}</div>}
            </div>
            <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "7px 9px", background: "#f7fafc" }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "#888" }}>Ship To</div>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{shipName}</div>
              <div style={{ fontSize: 11.5, color: "#333" }}>{client.ship_address ?? client.address ?? "Same as billing"}</div>
            </div>
          </div>
          {hasT && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 16px", border: "1px solid #d8d2c4", borderRadius: 6, padding: "5px 9px", marginBottom: 8, background: "#f7f5ef", fontSize: 10.5 }}>
              <span style={{ fontWeight: 800, textTransform: "uppercase", color: "#5b2e0a", fontSize: 8.5, letterSpacing: "0.05em", alignSelf: "center" }}>🚚 Transport</span>
              {transport.company && <span><strong>Company:</strong> {transport.company}{transport.phone ? ` · ☎ ${transport.phone}` : ""}</span>}
              {transport.lr && <span><strong>LR No:</strong> {transport.lr}</span>}
              {transport.vehicle && <span><strong>Vehicle:</strong> {transport.vehicle}</span>}
              {transport.driver && <span><strong>Driver:</strong> {transport.driver}{transport.driverPhone ? ` · ☎ ${transport.driverPhone}` : ""}</span>}
            </div>
          )}
          {filled.length === 0 ? <p style={{ color: "#888", fontSize: 11 }}>No line items yet.</p> : filled.map((s, gi) => (
            <div key={gi} style={{ marginBottom: 8 }}>
              {(filled.length > 1 || s.head.trim()) && <div style={{ fontSize: 10.5, fontWeight: 800, color: "#5b2e0a", background: "#f3efe7", borderLeft: "3px solid #7c4a1e", borderRadius: 3, padding: "4px 9px", textTransform: "uppercase" }}>{s.head.trim() || `Table ${gi + 1}`}</div>}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={ph}>#</th><th style={{ ...ph, textAlign: "left" }}>Item / Particulars</th><th style={ph}>HSN</th><th style={ph}>Unit</th><th style={{ ...ph, textAlign: "right" }}>Qty</th></tr></thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={pcell}>{i + 1}</td>
                      <td style={{ ...pcell, textTransform: "uppercase" }}>{l.particulars || "-"}</td>
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

function NewClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GstMode>(null);
  const [cat, setCat] = useState("");

  function submit(fd: FormData) {
    const name = String(fd.get("name") || "").trim();
    if (!name) { setError("Client name is required."); return; }
    fd.set("gst_mode", mode ?? "");
    start(async () => {
      setError(null);
      const r = await upsertInvoicePartyAction(fd);
      if (!r.ok) { setError(r.error); return; }
      onSaved(name);
    });
  }
  const fld: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 };
  const lbl = (s: string) => <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{s}</span>;

  return (
    <div onMouseDown={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <form action={submit} onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(620px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>＋ New client</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label className="stack">{lbl("Client name *")}<input name="name" required style={fld} /></label>
          <label className="stack">{lbl("Category / head")}<Combobox name="category" value={cat} onChange={setCat} options={CATEGORY_HINTS} placeholder="e.g. Maintenance & repair" inputStyle={fld} /></label>
          <label className="stack">{lbl("GSTIN")}<input name="gstin" style={fld} /></label>
          <label className="stack">{lbl("PAN")}<input name="pan" style={fld} /></label>
          <label className="stack">{lbl("Phone")}<input name="phone" style={fld} /></label>
          <label className="stack">{lbl("Email")}<input name="email" style={fld} /></label>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>Billing address</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label className="stack" style={{ gridColumn: "1 / -1" }}>{lbl("Address")}<input name="address" style={fld} /></label>
          <label className="stack">{lbl("City")}<input name="city" style={fld} /></label>
          <label className="stack">{lbl("State")}<input name="state" style={fld} /></label>
          <label className="stack">{lbl("State code")}<input name="state_code" style={fld} /></label>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>Shipping address <span style={{ fontWeight: 600, textTransform: "none" }}>(blank = same as billing)</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label className="stack">{lbl("Ship to name")}<input name="ship_name" style={fld} /></label>
          <label className="stack" style={{ gridColumn: "1 / -1" }}>{lbl("Ship address")}<input name="ship_address" style={fld} /></label>
          <label className="stack">{lbl("Ship city")}<input name="ship_city" style={fld} /></label>
          <label className="stack">{lbl("Ship state")}<input name="ship_state" style={fld} /></label>
          <label className="stack">{lbl("Ship state code")}<input name="ship_state_code" style={fld} /></label>
          <label className="stack">{lbl("Ship GSTIN")}<input name="ship_gstin" style={fld} /></label>
          <label className="stack">{lbl("Ship phone")}<input name="ship_phone" style={fld} /></label>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>Default GST</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {([["none", "No GST"], ["igst", "IGST"], ["cgst_sgst", "CGST + SGST"]] as const).map(([val, label]) => {
            const on = (mode ?? "none") === val;
            return <button key={val} type="button" onClick={() => setMode(val === "none" ? null : (val as GstMode))} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 800, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--bg)", color: on ? "#fff" : "var(--text)" }}>{label}</button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {mode === "igst" && <label className="stack" style={{ maxWidth: 120 }}>{lbl("IGST %")}<input name="igst_percent" defaultValue="18" inputMode="decimal" style={fld} /></label>}
          {mode === "cgst_sgst" && <><label className="stack" style={{ maxWidth: 120 }}>{lbl("CGST %")}<input name="cgst_percent" defaultValue="9" inputMode="decimal" style={fld} /></label><label className="stack" style={{ maxWidth: 120 }}>{lbl("SGST %")}<input name="sgst_percent" defaultValue="9" inputMode="decimal" style={fld} /></label></>}
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#b91c1c" }}>⚠ {error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={pending} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={pending} style={{ ...btnPrimary, background: "#0f172a" }}>{pending ? "Saving…" : "Save client"}</button>
        </div>
      </form>
    </div>
  );
}

/** Our own searchable client dropdown (replaces the browser <select>): a styled
 *  button → a panel with a search box + grouped Clients / Temples list. */
function ClientPicker({ clients, value, onChange }: { clients: Party[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const sel = clients.find((c) => c.id === value) ?? null;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const ql = q.trim().toLowerCase();
  const hit = (c: Party) => !ql || c.name.toLowerCase().includes(ql);
  const realClients = clients.filter((c) => !c.id.startsWith("temple:") && hit(c));
  const temples = clients.filter((c) => c.id.startsWith("temple:") && hit(c));
  const pick = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...FIELD, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel ? "var(--text)" : "var(--muted)", fontWeight: sel ? 700 : 400 }}>
          {sel ? `${sel.id.startsWith("temple:") ? "🛕 " : ""}${sel.name}` : "Select a client…"}
        </span>
        <span style={{ color: "var(--muted)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 60, background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 16px 42px rgba(0,0,0,0.28)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search client or temple…" autoComplete="off" style={{ ...FIELD, padding: "8px 10px" }} />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", padding: "4px 0" }}>
            {realClients.length === 0 && temples.length === 0 && <div className="muted" style={{ padding: "10px 14px", fontSize: 12.5 }}>No match.</div>}
            {realClients.length > 0 && <div style={grpHd}>Clients</div>}
            {realClients.map((c) => <ClientRow key={c.id} c={c} active={c.id === value} onPick={() => pick(c.id)} />)}
            {temples.length > 0 && <div style={grpHd}>Temples</div>}
            {temples.map((c) => <ClientRow key={c.id} c={c} temple active={c.id === value} onPick={() => pick(c.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}
function ClientRow({ c, temple, active, onPick }: { c: Party; temple?: boolean; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 14px", border: "none", background: active ? "rgba(180,83,9,0.1)" : "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
      <span style={{ width: 12, color: "var(--gold-dark)", fontWeight: 900 }}>{active ? "✓" : ""}</span>
      <span style={{ fontWeight: 600 }}>{temple ? "🛕 " : ""}{c.name}</span>
    </button>
  );
}
const tlbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted)" };
const grpHd: React.CSSProperties = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", padding: "6px 14px 3px" };

const seg = (active: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
const CARD: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "16px", background: "var(--surface)" };
const FIELD: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 };
const btnPrimary: React.CSSProperties = { fontSize: 14, padding: "11px 22px", fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 11, cursor: "pointer" };
const btnGhost: React.CSSProperties = { fontSize: 13, padding: "9px 16px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, cursor: "pointer" };
const btnSmall: React.CSSProperties = { fontSize: 12, padding: "7px 11px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" };
const btnLink: React.CSSProperties = { ...btnSmall, textDecoration: "none", color: "var(--muted)" };
