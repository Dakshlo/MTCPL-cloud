/**
 * Production DPR — owner/developer daily production report.
 *
 * Excel-style grid: for the chosen window (daily/weekly/monthly/yearly)
 * every pipeline stage, itemised by code with quantity + CFT, plus a
 * summary strip and an Excel download. Math lives in production-dpr.ts;
 * this is a thin presentation layer (mirrors the cutter cost report).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { cutterPeriodFromSearch, type CutterPeriodKind } from "@/lib/cutter-cost-report";
import { buildProductionDpr, type DprStage } from "@/lib/production-dpr";

type Search = Promise<Record<string, string | string[] | undefined>>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function fmtCft(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function istTodayKey(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function istWeekStartKey(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const daysBack = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysBack * 86_400_000);
  return `${m.getUTCFullYear()}-${pad2(m.getUTCMonth() + 1)}-${pad2(m.getUTCDate())}`;
}

function exportHref(kind: CutterPeriodKind, startDate: string): string {
  const y = startDate.slice(0, 4);
  const m = Number(startDate.slice(5, 7));
  if (kind === "daily") return `/api/reports/dpr.xlsx?view=daily&date=${startDate}`;
  if (kind === "weekly") return `/api/reports/dpr.xlsx?view=weekly&start=${startDate}`;
  if (kind === "yearly") return `/api/reports/dpr.xlsx?view=yearly&year=${y}`;
  return `/api/reports/dpr.xlsx?view=monthly&year=${y}&month=${m}`;
}

export default async function DprPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const period = cutterPeriodFromSearch(sp);
  const report = await buildProductionDpr(period);

  const view: CutterPeriodKind = period.kind;
  const todayStr = istTodayKey();
  const weekStartStr = istWeekStartKey();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const years = [curYear - 1, curYear, curYear + 1];
  // Daily view shows every code expanded; wider windows start collapsed.
  const openByDefault = view === "daily";

  return (
    <section style={{ paddingBottom: 24 }}>
      {/* Header */}
      <header
        style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
          padding: "16px 18px", marginBottom: 16,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={eyebrow()}>Production DPR</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {report.period.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Every stage of the line · by code · quantity + CFT
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
          <TabLink href={`/reports/dpr?view=daily&date=${todayStr}`} active={view === "daily"}>Daily</TabLink>
          <TabLink href={`/reports/dpr?view=weekly&start=${weekStartStr}`} active={view === "weekly"}>Weekly</TabLink>
          <TabLink href={`/reports/dpr?view=monthly&year=${curYear}&month=${curMonth}`} active={view === "monthly"}>Monthly</TabLink>
          <TabLink href={`/reports/dpr?view=yearly&year=${curYear}`} active={view === "yearly"}>Yearly</TabLink>
          <a
            href={exportHref(view, period.startDate)}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
              background: "#15803d", color: "#fff", border: "1px solid #126b33",
              borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            ⬇ Excel
          </a>
        </div>
      </header>

      {/* Period picker */}
      <div style={{ padding: "12px 18px", marginBottom: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
        {view === "daily" && (
          <form method="get" action="/reports/dpr" style={pickerRow()}>
            <input type="hidden" name="view" value="daily" />
            <PickerLabel>Date</PickerLabel>
            <input type="date" name="date" defaultValue={period.startDate} style={pickerInput()} />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "weekly" && (
          <form method="get" action="/reports/dpr" style={pickerRow()}>
            <input type="hidden" name="view" value="weekly" />
            <PickerLabel>Week start (Mon)</PickerLabel>
            <input type="date" name="start" defaultValue={period.startDate} style={pickerInput()} />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "monthly" && (
          <form method="get" action="/reports/dpr" style={pickerRow()}>
            <input type="hidden" name="view" value="monthly" />
            <PickerLabel>Month</PickerLabel>
            <select name="month" defaultValue={Number(period.startDate.slice(5, 7))} style={pickerInput()}>
              {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select name="year" defaultValue={Number(period.startDate.slice(0, 4))} style={pickerInput()}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "yearly" && (
          <form method="get" action="/reports/dpr" style={pickerRow()}>
            <input type="hidden" name="view" value="yearly" />
            <PickerLabel>Year</PickerLabel>
            <select name="year" defaultValue={Number(period.startDate.slice(0, 4))} style={pickerInput()}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
      </div>

      {/* Summary strip — Excel-style overview, one row per stage */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", ...eyebrow() }}>Summary</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th()}>Stage</th>
                <th style={{ ...th(), textAlign: "right" }}>Qty</th>
                <th style={{ ...th(), textAlign: "right" }}>CFT</th>
              </tr>
            </thead>
            <tbody>
              {report.stages.map((s, i) => (
                <tr key={s.key} style={{ borderBottom: "1px solid var(--border-light)", background: i % 2 ? "var(--surface)" : "var(--surface-alt)" }}>
                  <td style={td()}>
                    <span style={{ fontWeight: 700 }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{s.kind === "block" ? "blocks" : "slabs"}</span>
                  </td>
                  <td style={numTd()}>{s.totalQty.toLocaleString("en-IN")}</td>
                  <td style={numTd()}>{fmtCft(s.totalCft)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-stage detail — code-wise */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {report.stages.map((s) => (
          <StagePanel key={s.key} stage={s} open={openByDefault} />
        ))}
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: "var(--muted)" }}>
        Generated {new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} ·
        CFT = L×W×H ÷ 1728 · &ldquo;Dispatched&rdquo; = truck approved &amp; sent.
      </div>
    </section>
  );
}

function StagePanel({ stage, open }: { stage: DprStage; open: boolean }) {
  return (
    <details open={open} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <summary
        style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "12px 16px", cursor: "pointer", listStyle: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{stage.label}</span>
        <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          <span><strong style={{ color: "var(--text)" }}>{stage.totalQty.toLocaleString("en-IN")}</strong> {stage.kind === "block" ? "blocks" : "slabs"}</span>
          <span>·</span>
          <span><strong style={{ color: "var(--text)" }}>{fmtCft(stage.totalCft)}</strong> CFT</span>
        </span>
      </summary>
      {stage.note && (
        <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--muted)", background: "var(--bg)", borderBottom: "1px solid var(--border-light)" }}>
          {stage.note}
        </div>
      )}
      {stage.items.length === 0 ? (
        <div style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>Nothing in this stage for the period.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th(), width: 56 }}>#</th>
                <th style={th()}>{stage.kind === "block" ? "Block code" : "Slab code"}</th>
                <th style={{ ...th(), textAlign: "right" }}>Qty</th>
                <th style={{ ...th(), textAlign: "right" }}>CFT</th>
              </tr>
            </thead>
            <tbody>
              {stage.items.map((it, i) => (
                <tr key={it.code + i} style={{ borderBottom: "1px solid var(--border-light)", background: i % 2 ? "var(--surface)" : "var(--surface-alt)" }}>
                  <td style={{ ...td(), color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                  <td style={{ ...td(), fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                    {it.code}
                    {it.meta && <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--muted)" }}>· {it.meta}</span>}
                  </td>
                  <td style={numTd()}>{it.qty}</td>
                  <td style={numTd()}>{fmtCft(it.cft)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--bg)", borderTop: "2px solid var(--gold)" }}>
                <td style={td()} />
                <td style={{ ...td(), fontWeight: 800 }}>Total</td>
                <td style={{ ...numTd(), fontWeight: 800 }}>{stage.totalQty.toLocaleString("en-IN")}</td>
                <td style={{ ...numTd(), fontWeight: 800 }}>{fmtCft(stage.totalCft)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

// ── primitives ──────────────────────────────────────────────────────
function eyebrow(): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" };
}
function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: "8px 14px", fontSize: 12, fontWeight: 700,
      background: active ? "var(--gold)" : "var(--bg)", color: active ? "#fff" : "var(--text)",
      border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`, borderRadius: 8,
      textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{children}</Link>
  );
}
function PickerLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</span>;
}
function pickerRow(): React.CSSProperties {
  return { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 };
}
function pickerInput(): React.CSSProperties {
  return { padding: "7px 10px", fontSize: 13, background: "#fff", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7 };
}
function pickerBtn(): React.CSSProperties {
  return { padding: "7px 14px", fontSize: 12, fontWeight: 700, background: "var(--gold)", color: "#fff", border: "1px solid var(--gold-dark)", borderRadius: 7, cursor: "pointer" };
}
function th(): React.CSSProperties {
  return { padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" };
}
function td(): React.CSSProperties {
  return { padding: "8px 14px", fontSize: 12.5, color: "var(--text)" };
}
function numTd(): React.CSSProperties {
  return { padding: "8px 14px", fontSize: 12.5, color: "var(--text)", textAlign: "right", fontFamily: "ui-monospace, monospace" };
}
