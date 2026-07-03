"use client";

/**
 * Invoicing dashboard body (Daksh, Jul 2026) — two sections:
 *   • ALL — every challan/stage, temple-wise (the existing DashboardBoard).
 *   • INVOICED — every issued invoice (temple purchase / work order / running /
 *     other) newest-first, with a Recent ⇄ Party-wise toggle, a date-range
 *     filter, an overall total (₹ + count), per-party totals, and a click-to-open
 *     per-party summary (invoices · CFT · SFT · NOS · taxed · total).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardBoard, type DashGroup } from "./dashboard-board";
import type { InvoiceSummaryRow, InvoiceSource } from "@/lib/invoicing-summary";

const SRC: Record<InvoiceSource, { label: string; color: string; bg: string }> = {
  purchase: { label: "Purchase", color: "#0f766e", bg: "rgba(15,118,110,0.12)" },
  work_order: { label: "Work order", color: "#6d28d9", bg: "rgba(124,58,237,0.12)" },
  running: { label: "Running", color: "#b45309", bg: "rgba(180,83,9,0.14)" },
  other: { label: "Other", color: "#0369a1", bg: "rgba(3,105,161,0.12)" },
};
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => (n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

export function DashboardTabs({ groups, total, invoiced }: { groups: DashGroup[]; total: number; invoiced: InvoiceSummaryRow[] }) {
  const [tab, setTab] = useState<"all" | "invoiced">("all");
  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 13.5, fontWeight: 800, padding: "9px 18px", borderRadius: 10, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  return (
    <div>
      <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 16 }}>
        <button type="button" onClick={() => setTab("all")} style={seg(tab === "all")}>📋 All <span style={{ opacity: 0.7 }}>· {total}</span></button>
        <button type="button" onClick={() => setTab("invoiced")} style={seg(tab === "invoiced")}>🧾 Invoiced <span style={{ opacity: 0.7 }}>· {invoiced.length}</span></button>
      </div>
      {tab === "all" ? <DashboardBoard groups={groups} total={total} /> : <InvoicedView rows={invoiced} />}
    </div>
  );
}

function InvoicedView({ rows }: { rows: InvoiceSummaryRow[] }) {
  const [view, setView] = useState<"recent" | "party">("recent");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openParty, setOpenParty] = useState<string | null>(null);

  const filtered = useMemo(() => rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)), [rows, from, to]);
  const totalAmt = filtered.reduce((a, r) => a + r.amount, 0);
  const totalTax = filtered.reduce((a, r) => a + r.taxed, 0);

  const parties = useMemo(() => {
    const m = new Map<string, InvoiceSummaryRow[]>();
    for (const r of filtered) { const a = m.get(r.party) ?? []; a.push(r); m.set(r.party, a); }
    return [...m.entries()].map(([party, rs]) => ({
      party, rs, count: rs.length,
      amount: rs.reduce((a, r) => a + r.amount, 0),
      taxed: rs.reduce((a, r) => a + r.taxed, 0),
      cft: rs.reduce((a, r) => a + r.cft, 0),
      sft: rs.reduce((a, r) => a + r.sft, 0),
      nos: rs.reduce((a, r) => a + r.nos, 0),
    })).sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  const dateInp: React.CSSProperties = { padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const th: React.CSSProperties = { padding: "7px 10px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "ui-monospace, monospace" };

  return (
    <div>
      {/* Controls: date range + view toggle */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInp} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInp} /></label>
        {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}>Clear dates</button>}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
          <button type="button" onClick={() => setView("recent")} style={seg(view === "recent")}>🕑 Recent</button>
          <button type="button" onClick={() => setView("party")} style={seg(view === "party")}>👥 Party-wise</button>
        </div>
      </div>

      {/* Overall totals */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Total invoiced{(from || to) ? " (in range)" : ""}</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>₹ {money(totalAmt)}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Total tax (GST)</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>₹ {money(totalTax)}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{view === "party" ? `${parties.length} part${parties.length !== 1 ? "ies" : "y"}` : "across all parties"}</div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>No invoices{(from || to) ? " in this date range" : " yet"}.</div>
      ) : view === "recent" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((r) => {
            const s = SRC[r.source];
            return (
              <Link key={`${r.source}:${r.id}`} href={r.href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "11px 14px", border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface)", textDecoration: "none", color: "var(--text)" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, minWidth: 120 }}>{r.code}</span>
                <span style={{ flex: "1 1 160px", minWidth: 0, fontWeight: 700, fontSize: 13 }}>{r.party}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: s.color, background: s.bg, borderRadius: 999, padding: "2px 9px" }}>{s.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)", minWidth: 90 }}>{fmtDate(r.date)}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, minWidth: 110, textAlign: "right" }}>₹ {money(r.amount)}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {parties.map((p) => {
            const open = openParty === p.party;
            return (
              <div key={p.party} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
                <button type="button" onClick={() => setOpenParty(open ? null : p.party)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                  <span style={{ fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--gold-dark)" }}>▶</span>
                  <span style={{ fontSize: 14.5, fontWeight: 800 }}>{p.party}</span>
                  <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{p.count} invoice{p.count !== 1 ? "s" : ""}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>₹ {money(p.amount)}</span>
                </button>
                {open && (
                  <div style={{ padding: "6px 14px 14px" }}>
                    {/* Per-party summary */}
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
                      <thead><tr>
                        <th style={{ ...th, textAlign: "left" }}>Summary</th><th style={th}>Invoices</th><th style={th}>Total CFT</th><th style={th}>Total SFT</th><th style={th}>Total NOS</th><th style={th}>Taxed ₹</th><th style={th}>Total ₹</th>
                      </tr></thead>
                      <tbody><tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                        <td style={{ padding: "8px 10px", fontSize: 12.5 }}>{p.party}</td>
                        <td style={td}>{p.count}</td><td style={td}>{qty(p.cft)}</td><td style={td}>{qty(p.sft)}</td><td style={td}>{qty(p.nos)}</td><td style={td}>{money(p.taxed)}</td><td style={td}>{money(p.amount)}</td>
                      </tr></tbody>
                    </table>
                    {/* The party's invoices */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {p.rs.map((r) => {
                        const s = SRC[r.source];
                        return (
                          <Link key={`${r.source}:${r.id}`} href={r.href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", color: "var(--text)", fontSize: 12.5 }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, minWidth: 110 }}>{r.code}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, color: s.color, background: s.bg, borderRadius: 999, padding: "1px 8px" }}>{s.label}</span>
                            <span style={{ color: "var(--muted)", minWidth: 84 }}>{fmtDate(r.date)}</span>
                            <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>₹ {money(r.amount)}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
