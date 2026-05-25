/**
 * Mig 078 follow-on — CNC Various Costing dedicated page.
 *
 * Daksh's dad wanted a focused dashboard for CNC costing instead of
 * landing straight on the paper-mirror Excel-style monthly report.
 * Same period-toggle UX as the Cutter Costing page (daily / weekly
 * / monthly / yearly), but tailored to carving:
 *   • Two equal headline tiles: Cost per SFT and Cost per CFT.
 *   • An Output tile showing total CFT and SFT carved.
 *   • A Total Cost tile (operational only — depreciation lives on
 *     the full Excel report linked from the footer).
 *   • On Monthly: a Daily Average tile (mirrors Cutter Monthly).
 *   • A per-vendor breakdown table — this is the "vendor wise
 *     costing" Daksh's dad explicitly asked for.
 *   • The aggregate operational-expense breakdown by category.
 *
 * Footer keeps three navigation paths: ← Various Costing, Enter /
 * edit expenses, Open full Excel report ↗ (the existing
 * /carving/reports view, which carries depreciation + the
 * paper-shaped per-vendor cross-tab).
 *
 * Auth: canViewCncCosts (same as the existing /carving/reports
 * audience).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canViewCncCosts } from "@/lib/expenses-permissions";
import {
  buildCncVariousCostReport,
  cncPeriodFromSearch,
  type CncPeriodKind,
} from "@/lib/cnc-various-cost-report";

type Search = Promise<Record<string, string | string[] | undefined>>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CATEGORY_LABELS: Record<string, string> = {
  tools: "Tools",
  electricity: "Electricity",
  labor: "Labor",
  office: "Office",
  maintenance: "Maintenance",
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

export default async function CncVariousCostingPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canViewCncCosts(profile)) {
    redirect("/");
  }

  const sp = await searchParams;
  const period = cncPeriodFromSearch(sp);
  const report = await buildCncVariousCostReport(period);

  const view: CncPeriodKind = period.kind;
  const todayStr = istTodayKey();
  const weekStartStr = istWeekStartKey();
  const today = new Date();
  const curYear = today.getFullYear();
  const curMonth = today.getMonth() + 1;
  const years = [curYear - 1, curYear, curYear + 1];

  // Daily average — Monthly view only. Same logic as Cutter page.
  const dailyAvg = (() => {
    if (view !== "monthly") return null;
    const periodYear = Number(period.startDate.slice(0, 4));
    const periodMonth = Number(period.startDate.slice(5, 7));
    const istParts = (() => {
      const t = Date.now() + 5.5 * 60 * 60 * 1000;
      const d = new Date(t);
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      };
    })();
    let daysElapsed: number;
    if (periodYear > istParts.year || (periodYear === istParts.year && periodMonth > istParts.month)) {
      return null;
    }
    if (periodYear === istParts.year && periodMonth === istParts.month) {
      daysElapsed = istParts.day;
    } else {
      daysElapsed = new Date(periodYear, periodMonth, 0).getDate();
    }
    if (daysElapsed <= 0) return null;
    return {
      daysElapsed,
      cftPerDay: report.totalCft / daysElapsed,
      sftPerDay: report.totalSft / daysElapsed,
      // Daksh round 2 — daily cost now includes depreciation so the
      // rhythm matches the headline ₹/SFT (which is total cost ÷ SFT,
      // not operational-only ÷ SFT).
      costPerDay: report.totalCostForPeriod / daysElapsed,
    };
  })();

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
            Various Costing · CNC
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {report.period.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Cost per SFT / CFT · operational expenses ÷ carved output
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <TabLink
            href={`/reports/various-costing/cnc?view=daily&date=${todayStr}`}
            active={view === "daily"}
          >
            Daily
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cnc?view=weekly&start=${weekStartStr}`}
            active={view === "weekly"}
          >
            Weekly
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cnc?view=monthly&year=${curYear}&month=${curMonth}`}
            active={view === "monthly"}
          >
            Monthly
          </TabLink>
          <TabLink
            href={`/reports/various-costing/cnc?view=yearly&year=${curYear}`}
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
          <form method="get" action="/reports/various-costing/cnc" style={pickerRow()}>
            <input type="hidden" name="view" value="daily" />
            <PickerLabel>Date</PickerLabel>
            <input type="date" name="date" defaultValue={period.startDate} style={pickerInput()} />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "weekly" && (
          <form method="get" action="/reports/various-costing/cnc" style={pickerRow()}>
            <input type="hidden" name="view" value="weekly" />
            <PickerLabel>Week start (Mon)</PickerLabel>
            <input type="date" name="start" defaultValue={period.startDate} style={pickerInput()} />
            <button type="submit" style={pickerBtn()}>Show</button>
          </form>
        )}
        {view === "monthly" && (
          <form method="get" action="/reports/various-costing/cnc" style={pickerRow()}>
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
          <form method="get" action="/reports/various-costing/cnc" style={pickerRow()}>
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
        <DualKpiTile
          label="Cost per Unit"
          primary={`${fmtINR(report.costPerSft)} / SFT`}
          secondary={`${fmtINR(report.costPerCft)} / CFT`}
          hint="Operational + depreciation ÷ output"
          tone="accent"
        />
        <DualKpiTile
          label="Output"
          primary={`${fmtNum(report.totalSft)} SFT`}
          secondary={`${fmtNum(report.totalCft)} CFT`}
          hint={`${report.slabsCount} slabs counted`}
          tone="success"
        />
        <KpiTile
          label="Total Cost"
          value={fmtINR(report.totalCostForPeriod)}
          hint={`Op ${fmtINR(report.operationalForPeriod)} + Dep ${fmtINR(report.depreciationForPeriod)}`}
          tone="warning"
        />
        {dailyAvg && (
          <DualKpiTile
            label="Daily Average"
            primary={`${fmtNum(dailyAvg.sftPerDay)} SFT/day`}
            secondary={`${fmtINR(dailyAvg.costPerDay)}/day`}
            hint={`${dailyAvg.daysElapsed} day${dailyAvg.daysElapsed === 1 ? "" : "s"} · ${fmtNum(dailyAvg.cftPerDay)} CFT/day`}
            tone="accent"
          />
        )}
      </div>

      {/* ── Per-vendor breakdown ────────────────────────────── */}
      <Panel title="Per-vendor breakdown">
        {report.perVendor.length === 0 ? (
          <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
            No carving output and no expenses logged in this period.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th()}>Vendor</th>
                <th style={{ ...th(), textAlign: "right" }}>SFT</th>
                <th style={{ ...th(), textAlign: "right" }}>CFT</th>
                <th style={{ ...th(), textAlign: "right" }}>Slabs</th>
                <th style={{ ...th(), textAlign: "right" }}>Op. Cost</th>
                <th style={{ ...th(), textAlign: "right" }}>Dep.</th>
                <th style={{ ...th(), textAlign: "right" }}>Total</th>
                <th style={{ ...th(), textAlign: "right" }}>₹ / SFT</th>
                <th style={{ ...th(), textAlign: "right" }}>₹ / CFT</th>
              </tr>
            </thead>
            <tbody>
              {report.perVendor.map((v) => (
                <tr key={v.vendorId} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td(), fontWeight: 600 }}>{v.vendorName}</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {fmtNum(v.sft)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {fmtNum(v.cft)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>
                    {v.slabsCount}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {fmtINR(v.operationalCost)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>
                    {fmtINR(v.depreciationCost)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                    {fmtINR(v.totalCost)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {fmtINR(v.costPerSft)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {fmtINR(v.costPerCft)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#fffbeb", borderTop: "2px solid var(--gold)" }}>
                <td style={{ ...td(), fontWeight: 800 }}>Total</td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtNum(report.totalSft)}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtNum(report.totalCft)}
                </td>
                <td style={{ ...td(), textAlign: "right", color: "var(--muted)", fontWeight: 700 }}>
                  {report.slabsCount}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtINR(report.operationalForPeriod)}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "var(--muted)" }}>
                  {fmtINR(report.depreciationForPeriod)}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtINR(report.totalCostForPeriod)}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtINR(report.costPerSft)}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                  {fmtINR(report.costPerCft)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      {/* ── Aggregate cost breakdown (operational categories +
              depreciation row at the bottom). ─────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Cost breakdown">
          {report.totalCostForPeriod === 0 ? (
            <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
              No costs logged for this period.{" "}
              <Link href="/carving/expenses" style={{ color: "var(--gold)", fontWeight: 600 }}>
                Enter expenses →
              </Link>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th()}>Line</th>
                  <th style={{ ...th(), textAlign: "right" }}>Amount (prorated)</th>
                  <th style={{ ...th(), textAlign: "right" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {report.expenseBreakdown
                  .filter((b) => b.amount > 0)
                  .map((b) => {
                    const share =
                      report.totalCostForPeriod > 0
                        ? (b.amount / report.totalCostForPeriod) * 100
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
                {/* Operational subtotal — only renders when there's
                    BOTH operational expenses AND depreciation to
                    distinguish (otherwise it's just noise). */}
                {report.operationalForPeriod > 0 && report.depreciationForPeriod > 0 && (
                  <tr style={{ background: "var(--bg)" }}>
                    <td style={{ ...td(), fontWeight: 700 }}>Operational subtotal</td>
                    <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                      {fmtINR(report.operationalForPeriod)}
                    </td>
                    <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>
                      {fmtNum(
                        report.totalCostForPeriod > 0
                          ? (report.operationalForPeriod / report.totalCostForPeriod) * 100
                          : 0,
                        1,
                      )}%
                    </td>
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td()}>Depreciation (prorated)</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                    {fmtINR(report.depreciationForPeriod)}
                  </td>
                  <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>
                    {fmtNum(
                      report.totalCostForPeriod > 0
                        ? (report.depreciationForPeriod / report.totalCostForPeriod) * 100
                        : 0,
                      1,
                    )}%
                  </td>
                </tr>
                <tr style={{ background: "#fffbeb", borderTop: "2px solid var(--gold)" }}>
                  <td style={{ ...td(), fontWeight: 800 }}>Total cost</td>
                  <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>
                    {fmtINR(report.totalCostForPeriod)}
                  </td>
                  <td style={td()} />
                </tr>
              </tbody>
            </table>
          )}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px dashed var(--border)",
              fontSize: 11,
              color: "var(--muted)",
              background: "var(--bg)",
            }}
          >
            ⚡ Sub-monthly views (daily / weekly) prorate both
            operational expenses AND depreciation by days-in-window ÷
            days-in-month. Depreciation uses WDV (Written Down Value)
            at the configured per-machine rate — same math as the
            full Excel report.
          </div>
        </Panel>
      </div>

      {/* ── Footer nav ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 16,
        }}
      >
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            href="/carving/reports"
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            📊 Open full Excel report ↗
          </Link>
          <Link
            href="/carving/expenses"
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
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: barColor }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function DualKpiTile({
  label,
  primary,
  secondary,
  hint,
  tone,
}: {
  label: string;
  primary: string;
  secondary: string;
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
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: barColor }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
        {primary}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", opacity: 0.85, marginTop: 2 }}>
        {secondary}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{hint}</div>}
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
