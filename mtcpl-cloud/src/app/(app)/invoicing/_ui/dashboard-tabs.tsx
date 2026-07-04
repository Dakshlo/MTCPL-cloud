"use client";

/**
 * Invoicing dashboard body (Daksh, Jul 2026) — three tabs:
 *   • ALL      — every challan/stage, temple-wise (the existing DashboardBoard).
 *   • CHALLANS — every challan document with its stage + per-row CFT / SFT /
 *     NOS / taxed / total (value appears once priced; bulk-invoiced challans
 *     show qty only — their value lives on the work-order invoice).
 *   • INVOICES — every issued invoice (purchase / work order / running / other).
 *
 * Both summary tabs share one view: date-range filter, Recent ⇄ Party-wise
 * toggle, a TOTALS strip on top (docs · CFT · SFT · NOS · taxed · total) shown
 * in BOTH views, per-ROW values on every line (not just on top), and a
 * full-detail Excel export (⬇) honouring the date range.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardBoard, type DashGroup } from "./dashboard-board";
import type { InvoiceSummaryRow, InvoiceSource, ChallanSummaryRow, ChallanStatus } from "@/lib/invoicing-summary";

const SRC: Record<InvoiceSource, { label: string; color: string; bg: string }> = {
  purchase: { label: "Purchase", color: "#0f766e", bg: "rgba(15,118,110,0.12)" },
  work_order: { label: "Work order", color: "#6d28d9", bg: "rgba(124,58,237,0.12)" },
  running: { label: "Running", color: "#b45309", bg: "rgba(180,83,9,0.14)" },
  other: { label: "Other", color: "#0369a1", bg: "rgba(3,105,161,0.12)" },
};
const STATUS: Record<ChallanStatus, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "#1d4ed8", bg: "rgba(37,99,235,0.10)" },
  in_approval: { label: "In approval", color: "#b45309", bg: "rgba(217,119,6,0.14)" },
  in_bulk: { label: "In bulk", color: "#6d28d9", bg: "rgba(124,58,237,0.12)" },
  invoiced: { label: "Invoiced", color: "#15803d", bg: "rgba(22,101,52,0.12)" },
  running: { label: "Running bill", color: "#b45309", bg: "rgba(180,83,9,0.14)" },
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => (n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
const moneyDash = (n: number) => (n ? `₹ ${money(n)}` : "—");
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/** One normalised line for the shared summary view. */
type ViewRow = {
  key: string;
  code: string;
  invCode: string | null;
  party: string;
  badge: { label: string; color: string; bg: string };
  date: string;
  amount: number;
  taxed: number;
  cft: number;
  sft: number;
  nos: number;
  href: string;
};

export function DashboardTabs({ groups, total, invoiced, challans }: {
  groups: DashGroup[];
  total: number;
  invoiced: InvoiceSummaryRow[];
  challans: ChallanSummaryRow[];
}) {
  const [tab, setTab] = useState<"all" | "challans" | "invoices">("all");
  const invoiceRows = useMemo<ViewRow[]>(
    () => invoiced.map((r) => ({ key: `${r.source}:${r.id}`, code: r.code, invCode: null, party: r.party, badge: SRC[r.source], date: r.date, amount: r.amount, taxed: r.taxed, cft: r.cft, sft: r.sft, nos: r.nos, href: r.href })),
    [invoiced],
  );
  const challanRows = useMemo<ViewRow[]>(
    () => challans.map((r) => ({ key: `ch:${r.id}`, code: r.code, invCode: r.invCode, party: r.party, badge: STATUS[r.status], date: r.date, amount: r.amount, taxed: r.taxed, cft: r.cft, sft: r.sft, nos: r.nos, href: r.href })),
    [challans],
  );
  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 13.5, fontWeight: 800, padding: "9px 18px", borderRadius: 10, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  return (
    <div>
      <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab("all")} style={seg(tab === "all")}>📋 All <span style={{ opacity: 0.7 }}>· {total}</span></button>
        <button type="button" onClick={() => setTab("challans")} style={seg(tab === "challans")}>🚚 Challans <span style={{ opacity: 0.7 }}>· {challans.length}</span></button>
        <button type="button" onClick={() => setTab("invoices")} style={seg(tab === "invoices")}>🧾 Invoices <span style={{ opacity: 0.7 }}>· {invoiced.length}</span></button>
      </div>
      {tab === "all" ? (
        <DashboardBoard groups={groups} total={total} />
      ) : tab === "challans" ? (
        <SummaryView rows={challanRows} noun="challan" exportKind="challans" />
      ) : (
        <SummaryView rows={invoiceRows} noun="invoice" exportKind="invoices" />
      )}
    </div>
  );
}

/* ── Shared summary view (Challans + Invoices tabs) ────────────────── */

function SummaryView({ rows, noun, exportKind }: { rows: ViewRow[]; noun: "challan" | "invoice"; exportKind: "challans" | "invoices" }) {
  const [view, setView] = useState<"recent" | "party">("recent");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openParty, setOpenParty] = useState<string | null>(null);

  const filtered = useMemo(() => rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)), [rows, from, to]);
  const tot = useMemo(() => filtered.reduce(
    (a, r) => ({ amount: a.amount + r.amount, taxed: a.taxed + r.taxed, cft: a.cft + r.cft, sft: a.sft + r.sft, nos: a.nos + r.nos }),
    { amount: 0, taxed: 0, cft: 0, sft: 0, nos: 0 },
  ), [filtered]);

  const parties = useMemo(() => {
    const m = new Map<string, ViewRow[]>();
    for (const r of filtered) { const a = m.get(r.party) ?? []; a.push(r); m.set(r.party, a); }
    return [...m.entries()].map(([party, rs]) => ({
      party, rs, count: rs.length,
      amount: rs.reduce((a, r) => a + r.amount, 0),
      taxed: rs.reduce((a, r) => a + r.taxed, 0),
      cft: rs.reduce((a, r) => a + r.cft, 0),
      sft: rs.reduce((a, r) => a + r.sft, 0),
      nos: rs.reduce((a, r) => a + r.nos, 0),
    })).sort((a, b) => b.amount - a.amount || b.count - a.count);
  }, [filtered]);

  const exportHref = `/api/invoicing/summary-export?kind=${exportKind}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;

  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  const dateInp: React.CSSProperties = { padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const th: React.CSSProperties = { padding: "7px 10px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" };

  function Row({ r, showParty }: { r: ViewRow; showParty: boolean }) {
    return (
      <Link href={r.href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", textDecoration: "none", color: "var(--text)" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, minWidth: 106 }}>{r.code}</span>
        {r.invCode && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 700, color: "#15803d" }}>{r.invCode}</span>}
        {showParty && <span style={{ flex: "1 1 150px", minWidth: 0, fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.party}</span>}
        <span style={{ fontSize: 10, fontWeight: 800, color: r.badge.color, background: r.badge.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{r.badge.label}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 78 }}>{fmtDate(r.date)}</span>
        {/* Per-row values (Daksh) — every line carries its own numbers. */}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Mini label="CFT" value={qty(r.cft)} />
          <Mini label="SFT" value={qty(r.sft)} />
          <Mini label="NOS" value={qty(r.nos)} />
          <Mini label="Taxed" value={moneyDash(r.taxed)} />
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, minWidth: 104, textAlign: "right" }}>{moneyDash(r.amount)}</span>
        </span>
      </Link>
    );
  }

  return (
    <div>
      {/* Controls: date range + view toggle + export */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInp} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInp} /></label>
        {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}>Clear dates</button>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href={exportHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 800, padding: "9px 16px", borderRadius: 10, border: "none", background: "#15803d", color: "#fff", textDecoration: "none", whiteSpace: "nowrap" }}>⬇ Export Excel</a>
          <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button type="button" onClick={() => setView("recent")} style={seg(view === "recent")}>🕑 Recent</button>
            <button type="button" onClick={() => setView("party")} style={seg(view === "party")}>👥 Party-wise</button>
          </div>
        </div>
      </div>

      {/* TOTALS strip — aggregates live here only; every ROW below carries its
          own values (Daksh). Shown in BOTH Recent and Party-wise views. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
        <Tile label={`${noun === "challan" ? "Challans" : "Invoices"}${from || to ? " (range)" : ""}`} value={String(filtered.length)} />
        <Tile label="Total CFT" value={qty(tot.cft)} />
        <Tile label="Total SFT" value={qty(tot.sft)} />
        <Tile label="Total NOS" value={qty(tot.nos)} />
        <Tile label="Taxed (GST) ₹" value={money(tot.taxed)} />
        <Tile label="Total value ₹" value={money(tot.amount)} strong />
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>No {noun}s{(from || to) ? " in this date range" : " yet"}.</div>
      ) : view === "recent" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {filtered.map((r) => <Row key={r.key} r={r} showParty />)}
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
                  <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{p.count} {noun}{p.count !== 1 ? "s" : ""}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{moneyDash(p.amount)}</span>
                </button>
                {open && (
                  <div style={{ padding: "6px 14px 14px" }}>
                    {/* Party TOTAL row — aggregates only; each line below
                        carries its own values. */}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10, minWidth: 620 }}>
                        <thead><tr>
                          <th style={{ ...th, textAlign: "left" }}>Total</th><th style={th}>{noun === "challan" ? "Challans" : "Invoices"}</th><th style={th}>CFT</th><th style={th}>SFT</th><th style={th}>NOS</th><th style={th}>Taxed ₹</th><th style={th}>Total ₹</th>
                        </tr></thead>
                        <tbody><tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                          <td style={{ padding: "8px 10px", fontSize: 12.5 }}>{p.party}</td>
                          <td style={td}>{p.count}</td><td style={td}>{qty(p.cft)}</td><td style={td}>{qty(p.sft)}</td><td style={td}>{qty(p.nos)}</td><td style={td}>{money(p.taxed)}</td><td style={td}>{money(p.amount)}</td>
                        </tr></tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {p.rs.map((r) => <Row key={r.key} r={r} showParty={false} />)}
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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", minWidth: 52 }}>
      <span style={{ fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12 }}>{value}</span>
    </span>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", background: strong ? "rgba(22,101,52,0.06)" : "var(--surface)" }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 2, color: strong ? "#15803d" : "var(--text)" }}>{value}</div>
    </div>
  );
}
