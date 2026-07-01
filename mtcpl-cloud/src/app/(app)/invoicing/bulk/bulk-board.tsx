"use client";

/**
 * BulkBoard (Daksh, mig 175) — the Bulk challans pool in TWO tabs:
 *   • "Awaiting challan" — parked challans whose transport isn't filled yet. Each
 *     card: 🚚 Get challan (opens the transport form → generates the full challan
 *     + releases the dispatch), a NOT-VALID draft download, and Send back.
 *   • "Challan ready" — transport filled (full_challan_at). Each card: a valid
 *     Download (for the driver) + Send back.
 * Temple sections default collapsed, search across temple / challan no / slab code.
 */

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BulkSendBack } from "./bulk-send-back";
import { saveBulkTransportAction } from "../actions";

export type BulkCard = {
  id: string; code: string; date: string; sourceDispatchId: string | null; search: string;
  ready: boolean;
  transport: { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };
};
export type BulkGroup = { temple: string; rows: BulkCard[] };

function templeHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function BulkBoard({ groups, companies }: { groups: BulkGroup[]; companies: string[] }) {
  const [tab, setTab] = useState<"awaiting" | "ready">("awaiting");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [getChallan, setGetChallan] = useState<BulkCard | null>(null);

  const q = query.trim().toLowerCase();
  const searchActive = q.length > 0;

  const counts = useMemo(() => {
    let awaiting = 0, ready = 0;
    for (const g of groups) for (const r of g.rows) (r.ready ? ready++ : awaiting++);
    return { awaiting, ready };
  }, [groups]);

  const filtered = useMemo(() => {
    const out: BulkGroup[] = [];
    for (const g of groups) {
      const rows = g.rows.filter((r) => (tab === "ready" ? r.ready : !r.ready) && (!searchActive || r.search.includes(q)));
      if (rows.length) out.push({ temple: g.temple, rows });
    }
    return out;
  }, [groups, tab, q, searchActive]);
  const shown = filtered.reduce((n, g) => n + g.rows.length, 0);

  const isExpanded = (t: string) => searchActive || (expanded[t] ?? allExpanded);
  const toggle = (t: string) => setExpanded((p) => ({ ...p, [t]: !(p[t] ?? allExpanded) }));

  const tabBtn = (active: boolean): React.CSSProperties => ({
    fontSize: 13, fontWeight: 800, padding: "9px 16px", borderRadius: 10, cursor: "pointer",
    border: `1.5px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
    background: active ? "var(--gold)" : "var(--bg)", color: active ? "#fff" : "var(--text)",
  });

  return (
    <>
      <style>{`
        .blk-card { transition: transform .12s ease, box-shadow .12s ease; }
        .blk-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,0.12); }
        .blk-temple { transition: background .12s ease; }
        .blk-temple:hover { background: var(--bg); }
        @keyframes blkLift { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab("awaiting")} style={tabBtn(tab === "awaiting")}>🚚 Awaiting challan · {counts.awaiting}</button>
        <button type="button" onClick={() => setTab("ready")} style={tabBtn(tab === "ready")}>✅ Challan ready · {counts.ready}</button>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 14, maxWidth: 520 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.55, pointerEvents: "none" }}>🔍</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search temple, challan no., or slab code…" style={{ width: "100%", padding: "11px 38px 11px 38px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface, #fff)", color: "var(--text)", fontSize: 14 }} />
        {query && <button type="button" onClick={() => setQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 6 }}>✕</button>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {searchActive ? <>Results <span style={{ color: "var(--text)" }}>· {shown}</span></> : <>{tab === "ready" ? "Ready" : "Awaiting"} <span style={{ color: "var(--text)" }}>· {tab === "ready" ? counts.ready : counts.awaiting}</span></>}
        </div>
        {!searchActive && filtered.length > 0 && (
          <button type="button" onClick={() => { setAllExpanded((v) => !v); setExpanded({}); }} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: "pointer" }}>
            {allExpanded ? "⊖ Collapse all" : "⊕ Expand all"}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          {searchActive ? <>No challans match <strong>“{query}”</strong>.</>
            : tab === "ready" ? <>No challans are ready yet. Fill transport on an <strong>Awaiting</strong> challan to make its full challan.</>
            : <>Nothing awaiting. Send open challans here from the <Link href="/invoicing/challans" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>Challans</Link> page.</>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((g) => {
            const open = isExpanded(g.temple);
            const hue = templeHue(g.temple);
            return (
              <div key={g.temple} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface, #fff)" }}>
                <button type="button" className="blk-temple" onClick={() => toggle(g.temple)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", border: "none", background: "var(--bg)", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 13, fontWeight: 800, color: "#fff", background: `hsl(${hue} 55% 45%)` }}>
                    {g.temple.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "🛕"}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0 }}>{g.temple}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 10px" }}>{g.rows.length}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                </button>
                {open && (
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(262px, 1fr))", gap: 12 }}>
                    {g.rows.map((c) => (
                      <div key={c.id} className="blk-card" style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${c.ready ? "#15803d" : "#f59e0b"}`, borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px 13px", display: "flex", flexDirection: "column", gap: 9, animation: "blkLift 0.18s ease" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <Link href={`/invoicing/challans/${c.id}`} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15, color: "var(--text)", textDecoration: "none", letterSpacing: "-0.01em" }}>{c.code}</Link>
                          {c.ready
                            ? <span style={{ fontSize: 10.5, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>✅ Ready</span>
                            : <span style={{ fontSize: 10.5, fontWeight: 800, color: "#92400e", background: "rgba(245,158,11,0.16)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>🚚 No challan</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ opacity: 0.7 }}>📅</span>
                          {new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                        </div>
                        {c.ready && (c.transport.company || c.transport.lr) && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>🚚 {[c.transport.company, c.transport.lr ? `LR ${c.transport.lr}` : ""].filter(Boolean).join(" · ")}</div>
                        )}
                        <div style={{ marginTop: "auto", paddingTop: 4, display: "flex", gap: 7, flexWrap: "wrap" }}>
                          {c.ready ? (
                            c.sourceDispatchId && <Link href={`/dispatch/${c.sourceDispatchId}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1px solid var(--gold-dark)", borderRadius: 8, background: "var(--gold)", color: "#fff", textDecoration: "none" }}>🖨 Download challan</Link>
                          ) : (
                            <>
                              <button type="button" onClick={() => setGetChallan(c)} style={{ fontSize: 12, fontWeight: 800, padding: "8px 12px", border: "none", borderRadius: 8, background: "#0f172a", color: "#fff", cursor: "pointer" }}>🚚 Get challan</button>
                              {c.sourceDispatchId && <Link href={`/dispatch/${c.sourceDispatchId}/print?draft=1`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--muted)", textDecoration: "none" }}>🖨 Draft</Link>}
                            </>
                          )}
                          <BulkSendBack id={c.id} code={c.code} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {getChallan && <GetChallanModal card={getChallan} companies={companies} onClose={() => setGetChallan(null)} />}
    </>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Generating challan…" />
      <button type="submit" disabled={pending} style={{ fontSize: 13.5, fontWeight: 800, padding: "11px 20px", borderRadius: 11, border: "none", color: "#fff", background: pending ? "var(--border)" : "#0f172a", cursor: pending ? "default" : "pointer" }}>
        {pending ? "Saving…" : "✓ Generate full challan"}
      </button>
    </>
  );
}

function GetChallanModal({ card, companies, onClose }: { card: BulkCard; companies: string[]; onClose: () => void }) {
  const t = card.transport;
  const field: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
      <form action={saveBulkTransportAction} onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 20, boxShadow: "0 28px 70px rgba(0,0,0,0.4)" }}>
        <input type="hidden" name="id" value={card.id} />
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>🚚 Get challan — {card.code}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Fill transport, generate the driver&apos;s full challan, and put the truck on the road. Vehicle &amp; driver are prefilled from the dispatch.</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label><span style={lbl}>Transport company</span><input name="transport_company" list="bulk-transport-companies" defaultValue={t.company} placeholder="Company name" style={field} /><datalist id="bulk-transport-companies">{companies.map((n) => <option key={n} value={n} />)}</datalist></label>
          <label><span style={lbl}>LR no.</span><input name="lr_no" defaultValue={t.lr} placeholder="LR / builty no." style={field} /></label>
          <label><span style={lbl}>Transport phone <span style={{ fontWeight: 500 }}>(optional)</span></span><input name="transport_phone" defaultValue={t.phone} style={field} /></label>
          <label><span style={lbl}>Vehicle no.</span><input name="transport_vehicle_no" defaultValue={t.vehicle} style={field} /></label>
          <label><span style={lbl}>Driver name</span><input name="transport_driver_name" defaultValue={t.driver} style={field} /></label>
          <label><span style={lbl}>Driver phone</span><input name="transport_driver_phone" defaultValue={t.driverPhone} style={field} /></label>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
          <SubmitBtn />
        </div>
      </form>
    </div>
  );
}
