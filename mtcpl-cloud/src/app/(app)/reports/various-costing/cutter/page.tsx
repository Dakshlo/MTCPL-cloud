/**
 * Mig 060 — Cutter cost report. Shows cost-per-CFT for cutting the
 * raw blocks over a daily / weekly / monthly / yearly window.
 *
 * Auth: canViewCutterCosts (dev / owner / cnc_expense_entry / team_head).
 *
 * Math comes from buildCutterCostReport(period); this page is a thin
 * presentation layer. Three KPI tiles at the top, expense breakdown
 * + the dep-source snapshot under, then a footer with the view
 * toggle (daily / weekly / monthly / yearly).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canViewCutterCosts } from "@/lib/expenses-permissions";
import {
  buildCutterCostReport,
  cutterPeriodFromSearch,
  type CutterPeriodKind,
} from "@/lib/cutter-cost-report";

type Search = Promise<Record<string, string | string[] | undefined>>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CATEGORY_LABELS: Record<string, string> = {
  electricity: "Electricity",
  manpower: "Manpower",
  repair_maintenance: "Repair / Maintenance",
  other: "Other",
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtINR(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number, decimals = 2): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function istTodayKey(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function istWeekStartKey(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const weekday = d.getUTCDay();
  const daysBack = (weekday + 6) % 7;
  const monMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysBack * 86_400_000;
  const m = new Date(monMs);
  return `${m.getUTCFullYear()}-${pad2(m.getUTCMonth() + 1)}-${pad2(m.getUTCDate())}`;
}

export default async function CutterCostReportPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canViewCutterCosts(profile)) {
    redirect("/");
  }

  const sp = await searchParams;
  const period = cutterPeriodFromSearch(sp);
  const report = await buildCutterCostReport(period);

  const view: CutterPeriodKind = period.kind;
  const todayStr = istTodayKey();
  const weekStartStr = istWeekStartKey();
  const today = new Date();
  const curYear = today.getFullYear();
  const curMonth = today.getMonth() + 1;
  const years = [curYear - 1, curYear, curYear + 1];

  return (
    <section style={{ paddingBottom: 24 }}>
      {/* ── Header ───────────────────────────────────────────── */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          marginBottom: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            Various Costing · Cutter
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {report.period.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Cost per CFT cut · operational + depreciation ÷ block volume
          </div>
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <TabLink
            href={`/reports/various-costing/cutter?view=daily&date=${todayStr}`}
            active={view === "daily"}
          >
            Daily
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cutter?view=weekly&start=${weekStartStr}`}
            active={view === "weekly"}
          >
            Weekly
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cutter?view=monthly&year=${curYear}&month=${curMonth}`}
            active={view === "monthly"}
          >
            Monthly
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cutter?view=yearly&year=${curYear}`}
            active={view === "yearly"}
          >
            Yearly
          </TabLink>
        </div>
      </header>

      {/* ── Period picker (changes per view) ────────────────── */}
      <div
        style={{
          padding: "12px 18px",
          marginBottom: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}
      >
        {view === "daily" && (
          <form method="get" action="/reports/various-costing/cutter" style={pickerRow()}>
            <input type="hidden" name="view" value="daily" />
            <PickerLabel>Date</PickerLabel>
            <input
              type="date"
              name="date"
              defaultValue={period.startDate}
              style={pickerInput()}
            />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "weekly" && (
          <form method="get" action="/reports/various-costing/cutter" style={pickerRow()}>
            <input type="hidden" name="view" value="weekly" />
            <PickerLabel>Week start (Mon)</PickerLabel>
            <input
              type="date"
              name="start"
              defaultValue={period.startDate}
              style={pickerInput()}
            />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "monthly" && (
          <form method="get" action="/reports/various-costing/cutter" style={pickerRow()}>
            <input type="hidden" name="view" value="monthly" />
            <PickerLabel>Month</PickerLabel>
            <select name="month" defaultValue={Number(period.startDate.slice(5, 7))} style={pickerInput()}>
              {MONTH_NAMES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <select name="year" defaultValue={Number(period.startDate.slice(0, 4))} style={pickerInput()}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "yearly" && (
          <form method="get" action="/reports/various-costing/cutter" style={pickerRow()}>
            <input type="hidden" name="view" value="yearly" />
            <PickerLabel>Year</PickerLabel>
            <select name="year" defaultValue={Number(period.startDate.slice(0, 4))} style={pickerInput()}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
      </div>

      {/* ── KPI tiles ───────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <KpiTile
          label="Cost per CFT"
          value={fmtINR(report.costPerCft)}
          hint={`${fmtNum(report.totalCft)} CFT cut · ${fmtINR(report.totalCost)} total cost`}
          tone="accent"
        />
        <KpiTile
          label="CFT Cut"
          value={fmtNum(report.totalCft)}
          hint={`${report.blocksCut} blocks completed`}
          tone="success"
        />
        <KpiTile
          label="Total Cost"
          value={fmtINR(report.totalCost)}
          hint={`Op ${fmtINR(report.operationalForPeriod)} + Dep ${fmtINR(report.depreciationForPeriod)}`}
          tone="warning"
        />
      </div>

      {/* ── Expense breakdown + book-value snapshot side by side ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Panel title="Operational expense breakdown">
          {report.expenseBreakdown.every((b) => b.amount === 0) ? (
            <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
              No expenses logged for this period.{" "}
              <Link href="/cutting/expenses" style={{ color: "var(--gold)", fontWeight: 600 }}>
                Enter expenses →
              </Link>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th()}>Category</th>
                  <th style={{ ...th(), textAlign: "right" }}>Amount (prorated)</th>
                  <th style={{ ...th(), textAlign: "right" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {report.expenseBreakdown
                  .filter((b) => b.amount > 0)
                  .map((b) => {
                    const share = report.operationalForPeriod > 0
                      ? (b.amount / report.operationalForPeriod) * 100
                      : 0;
                    return (
                      <tr key={b.category} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={td()}>{CATEGORY_LABELS[b.category] ?? b.category}</td>
                        <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                          {fmtINR(b.amount)}
                        </td>
                        <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>
                          {fmtNum(share, 1)}%
                        </td>
                      </tr>
                    );
                  })}
                <tr style={{ background: "var(--bg)" }}>
                  <td style={{ ...td(), fontWeight: 700 }}>Operational subtotal</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                    {fmtINR(report.operationalForPeriod)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>—</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td()}>Depreciation (prorated)</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                    {fmtINR(report.depreciationForPeriod)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>—</td>
                </tr>
                <tr style={{ background: "#fffbeb", borderTop: "2px solid var(--gold)" }}>
                  <td style={{ ...td(), fontWeight: 800 }}>Total cost</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>
                    {fmtINR(report.totalCost)}
                  </td>
                  <td style={td()} />
                </tr>
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Depreciation source">
          {report.bookValueSnapshot ? (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <Row label="Book value" value={fmtINR(report.bookValueSnapshot.bookValue)} mono bold />
              <Row label="Useful life" value={`${report.bookValueSnapshot.usefulLifeYears} years`} />
              <Row label="Monthly depreciation" value={fmtINR(report.bookValueSnapshot.monthlyDepreciation)} mono />
              <Row label="Effective from" value={report.bookValueSnapshot.effectiveFrom ?? "—"} />
              <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--border)", fontSize: 11, color: "var(--muted)" }}>
                Period share: <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
                  {fmtINR(report.depreciationForPeriod)}
                </strong>
                {" "}× (days in period ÷ days in month)
              </div>
            </div>
          ) : (
            <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>
              No book value configured yet.{" "}
              <Link href="/cutting/expenses" style={{ color: "var(--gold)", fontWeight: 600 }}>
                Set it →
              </Link>
            </div>
          )}
        </Panel>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Link
          href="/reports/various-costing"
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          ← Various Costing
        </Link>
        <Link
          href="/cutting/expenses"
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Enter / edit expenses →
        </Link>
      </div>
    </section>
  );
}

// ── Tiny UI primitives ─────────────────────────────────────────────

function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "accent" | "success" | "warning";
}) {
  const barColor = tone === "accent" ? "var(--gold)" : tone === "success" ? "#10b981" : "#f59e0b";
  return (
    <div
      style={{
        position: "relative",
        padding: "16px 18px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: barColor,
        }}
      />
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span style={{
        fontSize: 14,
        fontWeight: bold ? 800 : 600,
        fontFamily: mono ? "ui-monospace, monospace" : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? "var(--gold)" : "var(--bg)",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
        borderRadius: 8,
        textDecoration: "none",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </Link>
  );
}

function PickerLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </span>
  );
}

function pickerRow(): React.CSSProperties {
  return { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 };
}

function pickerInput(): React.CSSProperties {
  return {
    padding: "7px 10px",
    fontSize: 13,
    background: "#fff",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 7,
  };
}

function pickerBtn(): React.CSSProperties {
  return {
    padding: "7px 14px",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--gold)",
    color: "#fff",
    border: "1px solid var(--gold-dark)",
    borderRadius: 7,
    cursor: "pointer",
  };
}

function th(): React.CSSProperties {
  return {
    padding: "10px 14px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    textAlign: "left",
  };
}

function td(): React.CSSProperties {
  return {
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--text)",
  };
}
