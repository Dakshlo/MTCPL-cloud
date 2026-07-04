"use client";

/**
 * Invoicing dashboard body (Daksh, Jul 2026) — three tabs:
 *   • ALL      — every challan/stage, temple-wise (the existing DashboardBoard).
 *   • CHALLANS — challan documents. Default scope = ONLY CHALLANS (not yet
 *     invoiced); a second scope shows everything incl. invoiced/running.
 *   • INVOICES — every issued invoice (purchase / work order / running / other).
 *
 * Both summary tabs share one PROPER TABLE view (everything aligned in
 * columns): Doc · Party · Status · Date · CFT · SFT · NOS · Taxable · GST ·
 * Total — per-row values on every line, aggregates only in the totals strip
 * (shown in BOTH Recent and Party-wise) and in each party's header row.
 * Excel: full-tab export + a per-party export (3 sheets: Combined / Only
 * challans / Only invoices), both honouring the date range.
 */

import { useMemo, useState } from "react";
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
const moneyDash = (n: number) => (n ? money(n) : "—");
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/** One normalised line for the shared summary view. */
type ViewRow = {
  key: string;
  code: string;
  invCode: string | null;
  party: string;
  badge: { label: string; color: string; bg: string };
  date: string;
  amount: number;   // grand total (0 = unpriced)
  taxed: number;    // GST portion
  taxable: number;  // amount - taxed
  cft: number;
  sft: number;
  nos: number;
  href: string;
  /** Challan rows only — still a challan (not yet invoiced/running-billed). */
  pending: boolean;
};

export function DashboardTabs({ groups, total, invoiced, challans }: {
  groups: DashGroup[];
  total: number;
  invoiced: InvoiceSummaryRow[];
  challans: ChallanSummaryRow[];
}) {
  const [tab, setTab] = useState<"all" | "challans" | "invoices">("all");
  const invoiceRows = useMemo<ViewRow[]>(
    () => invoiced.map((r) => ({ key: `${r.source}:${r.id}`, code: r.code, invCode: null, party: r.party, badge: SRC[r.source], date: r.date, amount: r.amount, taxed: r.taxed, taxable: r.amount - r.taxed, cft: r.cft, sft: r.sft, nos: r.nos, href: r.href, pending: false })),
    [invoiced],
  );
  const challanRows = useMemo<ViewRow[]>(
    () => challans.map((r) => ({ key: `ch:${r.id}`, code: r.code, invCode: r.invCode, party: r.party, badge: STATUS[r.status], date: r.date, amount: r.amount, taxed: r.taxed, taxable: r.amount - r.taxed, cft: r.cft, sft: r.sft, nos: r.nos, href: r.href, pending: r.status !== "invoiced" && r.status !== "running" })),
    [challans],
  );
  const pendingCount = useMemo(() => challanRows.filter((r) => r.pending).length, [challanRows]);
  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 13.5, fontWeight: 800, padding: "9px 18px", borderRadius: 10, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  return (
    <div>
      <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab("all")} style={seg(tab === "all")}>📋 All <span style={{ opacity: 0.7 }}>· {total}</span></button>
        <button type="button" onClick={() => setTab("challans")} style={seg(tab === "challans")}>🚚 Challans <span style={{ opacity: 0.7 }}>· {pendingCount}</span></button>
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
  // Challans tab: default = ONLY still-challans; "all" also shows invoiced ones.
  const [scope, setScope] = useState<"pending" | "all">(noun === "challan" ? "pending" : "all");

  const scoped = useMemo(() => (noun === "challan" && scope === "pending" ? rows.filter((r) => r.pending) : rows), [rows, noun, scope]);
  const filtered = useMemo(() => scoped.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)), [scoped, from, to]);
  const tot = useMemo(() => filtered.reduce(
    (a, r) => ({ amount: a.amount + r.amount, taxed: a.taxed + r.taxed, taxable: a.taxable + r.taxable, cft: a.cft + r.cft, sft: a.sft + r.sft, nos: a.nos + r.nos }),
    { amount: 0, taxed: 0, taxable: 0, cft: 0, sft: 0, nos: 0 },
  ), [filtered]);

  const parties = useMemo(() => {
    const m = new Map<string, ViewRow[]>();
    for (const r of filtered) { const a = m.get(r.party) ?? []; a.push(r); m.set(r.party, a); }
    return [...m.entries()].map(([party, rs]) => ({
      party, rs, count: rs.length,
      amount: rs.reduce((a, r) => a + r.amount, 0),
      taxed: rs.reduce((a, r) => a + r.taxed, 0),
      taxable: rs.reduce((a, r) => a + r.taxable, 0),
      cft: rs.reduce((a, r) => a + r.cft, 0),
      sft: rs.reduce((a, r) => a + r.sft, 0),
      nos: rs.reduce((a, r) => a + r.nos, 0),
    })).sort((a, b) => b.amount - a.amount || b.count - a.count);
  }, [filtered]);

  const range = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const exportHref = `/api/invoicing/summary-export?kind=${exportKind}${noun === "challan" ? `&scope=${scope}` : ""}${range}`;
  const partyHref = (party: string) => `/api/invoicing/summary-export?party=${encodeURIComponent(party)}${range}`;

  const seg = (active: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)" });
  const dateInp: React.CSSProperties = { padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 };

  return (
    <div>
      {/* Controls: date range + scope + view toggle + export */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInp} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInp} /></label>
        {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}>Clear dates</button>}
        {noun === "challan" && (
          <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button type="button" onClick={() => setScope("pending")} style={seg(scope === "pending")}>🚚 Only challans · {rows.filter((r) => r.pending).length}</button>
            <button type="button" onClick={() => setScope("all")} style={seg(scope === "all")}>All incl. invoiced · {rows.length}</button>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href={exportHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 800, padding: "9px 16px", borderRadius: 10, border: "none", background: "#15803d", color: "#fff", textDecoration: "none", whiteSpace: "nowrap" }}>⬇ Export Excel</a>
          <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button type="button" onClick={() => setView("recent")} style={seg(view === "recent")}>🕑 Recent</button>
            <button type="button" onClick={() => setView("party")} style={seg(view === "party")}>👥 Party-wise</button>
          </div>
        </div>
      </div>

      {/* TOTALS strip — aggregates live here only (both views). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(124px, 1fr))", gap: 10, marginBottom: 16 }}>
        <Tile label={`${noun === "challan" ? "Challans" : "Invoices"}${from || to ? " (range)" : ""}`} value={String(filtered.length)} />
        <Tile label="Total CFT" value={qty(tot.cft)} />
        <Tile label="Total SFT" value={qty(tot.sft)} />
        <Tile label="Total NOS" value={qty(tot.nos)} />
        <Tile label="Taxable ₹" value={money(tot.taxable)} />
        <Tile label="Taxed (GST) ₹" value={money(tot.taxed)} />
        <Tile label="Total value ₹" value={money(tot.amount)} strong />
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>No {noun}s{(from || to) ? " in this date range" : " yet"}.</div>
      ) : view === "recent" ? (
        <DocTable rows={filtered} noun={noun} showParty />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {parties.map((p) => {
            const open = openParty === p.party;
            return (
              <div key={p.party} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
                <div role="button" tabIndex={0} onClick={() => setOpenParty(open ? null : p.party)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpenParty(open ? null : p.party); } }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                  <span style={{ fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--gold-dark)" }}>▶</span>
                  <span style={{ fontSize: 14.5, fontWeight: 800 }}>{p.party}</span>
                  <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{p.count} {noun}{p.count !== 1 ? "s" : ""}</span>
                  {/* Per-party Excel — 3 sheets: Combined / Only challans / Only invoices. */}
                  <a
                    href={partyHref(p.party)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    title="Download this party's Excel — Combined + Challans + Invoices sheets"
                    style={{ fontSize: 11, fontWeight: 800, padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(22,101,52,0.4)", background: "rgba(22,101,52,0.08)", color: "#15803d", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    ⬇ Excel
                  </a>
                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>₹ {money(p.amount)}</span>
                </div>
                {open && (
                  <div style={{ padding: "6px 12px 14px" }}>
                    <DocTable
                      rows={p.rs}
                      noun={noun}
                      showParty={false}
                      totalRow={{ label: p.party, count: p.count, cft: p.cft, sft: p.sft, nos: p.nos, taxable: p.taxable, taxed: p.taxed, amount: p.amount }}
                    />
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

/* ── The aligned document table (both views) ───────────────────────── */

function DocTable({ rows, noun, showParty, totalRow }: {
  rows: ViewRow[];
  noun: "challan" | "invoice";
  showParty: boolean;
  totalRow?: { label: string; count: number; cft: number; sft: number; nos: number; taxable: number; taxed: number; amount: number };
}) {
  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)" };
  const thL: React.CSSProperties = { ...th, textAlign: "left" };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const tdL: React.CSSProperties = { ...td, textAlign: "left", fontFamily: "inherit" };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 11, overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: showParty ? 980 : 860 }}>
          <thead>
            <tr>
              <th style={thL}>{noun === "challan" ? "Challan no" : "Invoice no"}</th>
              {noun === "challan" && <th style={thL}>Invoice no</th>}
              {showParty && <th style={thL}>Party</th>}
              <th style={thL}>Status</th>
              <th style={thL}>Date</th>
              <th style={th}>CFT</th>
              <th style={th}>SFT</th>
              <th style={th}>NOS</th>
              <th style={th}>Taxable ₹</th>
              <th style={th}>Taxed (GST) ₹</th>
              <th style={th}>Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                onClick={() => window.open(r.href, "_blank", "noopener,noreferrer")}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,161,74,0.07)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ ...tdL, fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{r.code}</td>
                {noun === "challan" && <td style={{ ...tdL, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#15803d" }}>{r.invCode ?? "—"}</td>}
                {showParty && <td style={{ ...tdL, fontWeight: 700, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.party}</td>}
                <td style={tdL}><span style={{ fontSize: 10, fontWeight: 800, color: r.badge.color, background: r.badge.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{r.badge.label}</span></td>
                <td style={{ ...tdL, whiteSpace: "nowrap", color: "var(--muted)", fontSize: 11.5 }}>{fmtDate(r.date)}</td>
                <td style={td}>{qty(r.cft)}</td>
                <td style={td}>{qty(r.sft)}</td>
                <td style={td}>{qty(r.nos)}</td>
                <td style={td}>{moneyDash(r.taxable)}</td>
                <td style={td}>{moneyDash(r.taxed)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{moneyDash(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          {totalRow && (
            <tfoot>
              <tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                <td style={{ ...tdL, fontWeight: 800 }} colSpan={noun === "challan" ? 2 : 1}>TOTAL — {totalRow.label}</td>
                <td style={tdL}>{totalRow.count} {noun}{totalRow.count !== 1 ? "s" : ""}</td>
                <td style={tdL}></td>
                <td style={{ ...td, fontWeight: 800 }}>{qty(totalRow.cft)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{qty(totalRow.sft)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{qty(totalRow.nos)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{moneyDash(totalRow.taxable)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{moneyDash(totalRow.taxed)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{moneyDash(totalRow.amount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", background: strong ? "rgba(22,101,52,0.06)" : "var(--surface)" }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 2, color: strong ? "#15803d" : "var(--text)" }}>{value}</div>
    </div>
  );
}
