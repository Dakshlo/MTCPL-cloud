"use client";

/**
 * "Other Sales" (mig 176) — client UI. Create a non-temple challan (client +
 * free-typed line items), then convert it to an invoice (INV-<FY>-XX on the
 * shared counter). Clients reuse invoice_parties (billing + shipping + GST).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createOtherChallanAction, updateOtherChallanAction, convertOtherChallanAction, cancelOtherChallanAction } from "./actions";
import { upsertInvoicePartyAction } from "../actions";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";

export type Party = {
  id: string; name: string; gstin: string | null; pan: string | null;
  address: string | null; city: string | null; state: string | null; state_code: string | null; phone: string | null; email: string | null;
  ship_name: string | null; ship_address: string | null; ship_city: string | null; ship_state: string | null; ship_state_code: string | null; ship_gstin: string | null; ship_phone: string | null;
  gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null;
};
export type OtherItem = { particulars: string; hsn: string; unit: string; quantity: number; rate: number; amount: number };
export type OtherChallan = {
  id: string; code: string; date: string; partyId: string; partyName: string;
  gstMode: GstMode; igst: number; cgst: number; sgst: number; notes: string | null;
  items: OtherItem[]; converted: boolean; invoiceCode: string | null;
};

type Item = { particulars: string; hsn: string; unit: string; quantity: string; rate: string };
const blankItem = (): Item => ({ particulars: "", hsn: "", unit: "", quantity: "", rate: "" });
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function OtherSalesClient({
  clients, challans, ocPrefix, ocAuto, invPrefix, invAuto, preselectId, openNew, needsMigration,
}: {
  clients: Party[]; challans: OtherChallan[];
  ocPrefix: string; ocAuto: string; invPrefix: string; invAuto: string;
  preselectId?: string; openNew?: boolean; needsMigration?: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(!!openNew);
  const [editId, setEditId] = useState<string | null>(null);
  const [party, setParty] = useState(preselectId ?? "");
  const [date, setDate] = useState(todayIST());
  const [items, setItems] = useState<Item[]>([blankItem(), blankItem()]);
  const [mode, setMode] = useState<GstMode>(null);
  const [igst, setIgst] = useState("18");
  const [cgst, setCgst] = useState("9");
  const [sgst, setSgst] = useState("9");
  const [notes, setNotes] = useState("");
  const [convert, setConvert] = useState<OtherChallan | null>(null);
  const [clientModal, setClientModal] = useState(false);
  const [pendingClient, setPendingClient] = useState<string | null>(null);

  // After creating a client (which router.refresh()es the server data), auto-
  // select it once the refreshed clients list includes it + reopen the form.
  useEffect(() => {
    if (!pendingClient) return;
    const found = clients.find((c) => c.name.trim().toLowerCase() === pendingClient.trim().toLowerCase());
    if (found) { setParty(found.id); setPendingClient(null); setFormOpen(true); }
  }, [clients, pendingClient]);

  const cur = clients.find((c) => c.id === party) ?? null;

  function resetForm() {
    setEditId(null); setParty(""); setDate(todayIST()); setItems([blankItem(), blankItem()]);
    setMode(null); setIgst("18"); setCgst("9"); setSgst("9"); setNotes("");
  }
  function pickParty(id: string) {
    setParty(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      const m = c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null;
      setMode(m);
      if (c.igst_percent != null) setIgst(String(c.igst_percent));
      if (c.cgst_percent != null) setCgst(String(c.cgst_percent));
      if (c.sgst_percent != null) setSgst(String(c.sgst_percent));
    }
  }
  function startNew() { resetForm(); if (preselectId) setParty(preselectId); setFormOpen(true); }
  function startEdit(ch: OtherChallan) {
    setEditId(ch.id); setParty(ch.partyId); setDate(ch.date);
    setItems(ch.items.length ? ch.items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: it.quantity ? String(it.quantity) : "", rate: it.rate ? String(it.rate) : "" })) : [blankItem()]);
    setMode(ch.gstMode); setIgst(String(ch.igst || 18)); setCgst(String(ch.cgst || 9)); setSgst(String(ch.sgst || 9)); setNotes(ch.notes ?? "");
    setFormOpen(true);
  }

  const amountOf = (it: Item) => (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const totals = useMemo(
    () => computeInvoiceTotals(items.map(amountOf), { mode, igst: Number(igst) || 0, cgst: Number(cgst) || 0, sgst: Number(sgst) || 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, mode, igst, cgst, sgst],
  );
  const itemsJson = JSON.stringify(items.map((it) => ({ particulars: it.particulars, hsn: it.hsn, unit: it.unit, quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: amountOf(it) })));
  const hasItems = items.some((it) => it.particulars.trim() || amountOf(it) > 0);
  const canSubmit = !!party && hasItems;
  const setItem = (i: number, k: keyof Item, v: string) => setItems((p) => p.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const open = challans.filter((c) => !c.converted);
  const done = challans.filter((c) => c.converted);

  const cell: React.CSSProperties = { padding: "5px 7px", border: "1px solid var(--border)" };
  const inp: React.CSSProperties = { width: "100%", border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, padding: "3px 4px" };
  const num: React.CSSProperties = { ...inp, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  if (needsMigration) {
    return (
      <div className="banner" style={{ marginTop: 14 }}>
        ⚠ Run migration <strong>176_other_sales.sql</strong> on Supabase to enable Other Sales.
      </div>
    );
  }

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
          <input type="hidden" name="gst_mode" value={mode ?? ""} />
          <input type="hidden" name="igst_percent" value={igst} />
          <input type="hidden" name="cgst_percent" value={cgst} />
          <input type="hidden" name="sgst_percent" value={sgst} />
          <input type="hidden" name="challan_date" value={date} />
          <input type="hidden" name="notes" value={notes} />
          <input type="hidden" name="party_id" value={party} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{editId ? "Edit challan" : "New challan"} <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>· {editId ? "" : `${ocPrefix}${ocAuto}`}</span></h2>
            <button type="button" onClick={() => { setFormOpen(false); resetForm(); }} style={btnGhost}>Close</button>
          </div>

          {/* Client + date */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <label className="stack" style={{ flex: "1 1 320px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Client</span>
              <select value={party} onChange={(e) => pickParty(e.target.value)} required style={FIELD}>
                <option value="">Select a client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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

          {/* Line items */}
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
                    <td style={cell}><input value={it.particulars} onChange={(e) => setItem(i, "particulars", e.target.value)} style={inp} placeholder="Description of goods" /></td>
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
          <button type="button" onClick={() => setItems((p) => [...p, blankItem()])} style={{ ...btnGhost, marginTop: 10 }}>＋ Add line</button>

          {/* GST + totals */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 14 }}>
            <div style={{ flex: "1 1 320px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>GST</div>
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
              <label className="stack" style={{ marginTop: 12, maxWidth: 460 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Notes (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...FIELD, resize: "vertical" }} /></label>
            </div>
            <div style={{ flex: "0 0 280px", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--bg)" }}>
              <Row label="Subtotal" value={rupee(totals.subtotal)} />
              {mode === "igst" && <Row label={`IGST @ ${igst || 0}%`} value={rupee(totals.igstAmt)} />}
              {mode === "cgst_sgst" && <><Row label={`CGST @ ${cgst || 0}%`} value={rupee(totals.cgstAmt)} /><Row label={`SGST @ ${sgst || 0}%`} value={rupee(totals.sgstAmt)} /></>}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}><Row label="Grand Total" value={rupee(totals.grand)} bold /></div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
            <button type="submit" disabled={!canSubmit} style={{ ...btnPrimary, background: canSubmit ? "#0f172a" : "var(--border)", cursor: canSubmit ? "pointer" : "default" }}>
              {editId ? "💾 Save changes" : "🧾 Create challan"}
            </button>
            {!canSubmit && <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick a client and add at least one line item.</span>}
          </div>
        </form>
      )}

      {/* OPEN challans */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: "6px 0 8px" }}>Challans · {open.length}</div>
        {open.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, border: "1px dashed var(--border)", borderRadius: 10, padding: "18px", textAlign: "center" }}>No open challans. Create one above.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {open.map((ch) => <ChallanCard key={ch.id} ch={ch} onEdit={() => startEdit(ch)} onConvert={() => setConvert(ch)} />)}
          </div>
        )}
      </div>

      {/* CONVERTED (other invoices) */}
      {done.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: "10px 0 8px" }}>Invoiced · {done.length}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {done.map((ch) => <ChallanCard key={ch.id} ch={ch} />)}
          </div>
        </div>
      )}

      {convert && <ConvertModal ch={convert} invPrefix={invPrefix} invAuto={invAuto} onClose={() => setConvert(null)} />}
      {clientModal && <NewClientModal onClose={() => setClientModal(false)} onSaved={(name) => { setClientModal(false); setPendingClient(name); router.refresh(); }} />}
    </div>
  );
}

function ChallanCard({ ch, onEdit, onConvert }: { ch: OtherChallan; onEdit?: () => void; onConvert?: () => void }) {
  const total = ch.items.reduce((a, b) => a + (b.amount || 0), 0);
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${ch.converted ? "#15803d" : "#7C3AED"}`, borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>{ch.converted ? ch.invoiceCode ?? ch.code : ch.code}</span>
        {ch.converted
          ? <span style={{ fontSize: 10, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "2px 9px" }}>✓ INVOICED</span>
          : <span style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", background: "rgba(124,58,237,0.12)", borderRadius: 999, padding: "2px 9px" }}>CHALLAN</span>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>🏢 {ch.partyName}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📅 {new Date(`${ch.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })} · {ch.items.length} item{ch.items.length !== 1 ? "s" : ""} · <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{rupee(total)}</strong></div>
      <div style={{ marginTop: 2, display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Link href={`/invoicing/other/${ch.id}/print`} target="_blank" rel="noopener noreferrer" style={btnLink}>🖨 {ch.converted ? "Invoice" : "Challan"}</Link>
        {!ch.converted && onEdit && <button type="button" onClick={onEdit} style={btnSmall}>✎ Edit</button>}
        {!ch.converted && onConvert && <button type="button" onClick={onConvert} style={{ ...btnSmall, color: "#fff", background: "var(--gold)", border: "1px solid var(--gold-dark)" }}>🧾 Convert to invoice</button>}
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

function ConvertModal({ ch, invPrefix, invAuto, onClose }: { ch: OtherChallan; invPrefix: string; invAuto: string; onClose: () => void }) {
  const [num, setNum] = useState("");
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 20 }}>
      <form action={convertOtherChallanAction} onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <input type="hidden" name="other_challan_id" value={ch.id} />
        <input type="hidden" name="inv_seq" value={num} />
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>🧾 Convert {ch.code} to invoice</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px" }}>Assigns an invoice number on the shared series. Leave blank for the next auto number.</p>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>Invoice no.</span>
        <div style={{ display: "inline-flex", alignItems: "stretch", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "8px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, background: "var(--surface)", color: "var(--muted)", borderRight: "1.5px solid var(--border)" }}>{invPrefix}</span>
          <input value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder={invAuto} style={{ width: 90, textAlign: "left", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, padding: "8px 10px", border: "none", background: "transparent", color: "var(--text)" }} />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" style={{ ...btnPrimary, background: "#0f172a" }}>🧾 Convert to invoice</button>
        </div>
      </form>
    </div>
  );
}

function NewClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GstMode>(null);

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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "4px 0", fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 600 }}>
      <span>{label}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}

const CARD: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "16px", background: "var(--surface)" };
const FIELD: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 };
const btnPrimary: React.CSSProperties = { fontSize: 14, padding: "11px 22px", fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 11, cursor: "pointer" };
const btnGhost: React.CSSProperties = { fontSize: 13, padding: "9px 16px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, cursor: "pointer" };
const btnSmall: React.CSSProperties = { fontSize: 12, padding: "7px 11px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" };
const btnLink: React.CSSProperties = { ...btnSmall, textDecoration: "none", color: "var(--muted)" };
