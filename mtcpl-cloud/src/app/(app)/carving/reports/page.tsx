/**
 * CNC monthly report — HTML view that mirrors the format of the
 * paper sheet the office uses today (operator → machine columns →
 * per-day SQFT + CFT → grand total + averages).
 *
 * Owner / developer / carving_head only. Same numbers feed the
 * Excel export at /api/reports/cnc-monthly.xlsx.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  buildCncReport,
  cncPeriodFromSearch,
  type CncMonthlyReport,
  type CncReportPeriod,
} from "@/lib/cnc-monthly-report";
import { PrintButton } from "@/components/print-button";

type Search = Promise<{
  view?: string;
  date?: string;
  start?: string;
  year?: string;
  month?: string;
}>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0.00";
  return n.toFixed(digits);
}

// Mig 054 — INR formatter for cost columns. Uses Indian numbering
// (lakhs / crores groupings). Returns "—" for NaN / Infinity (zero-
// production divisions) and for true zero so the row visually
// admits "no expense entered for this period yet".
function inr(n: number): string {
  if (!isFinite(n)) return "—";
  if (n === 0) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function inrPrecise(n: number): string {
  if (!isFinite(n)) return "—";
  if (n === 0) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default async function CncMonthlyReportPage({ searchParams }: { searchParams: Search }) {
  await requireAuth(["developer", "owner", "carving_head"]);
  const params = await searchParams;
  // Mig 053 follow-on (Daksh) — derive period from query params,
  // supporting daily / weekly / monthly views. Default = current month.
  const period = cncPeriodFromSearch(params);
  const report = await buildCncReport(period);

  // Build the Excel download URL preserving the active view.
  const xlsxParams = new URLSearchParams();
  xlsxParams.set("view", period.kind);
  if (period.kind === "monthly") {
    xlsxParams.set("year", String(period.year));
    xlsxParams.set("month", String(period.month));
  } else if (period.kind === "weekly") {
    xlsxParams.set("start", period.startDate);
  } else {
    xlsxParams.set("date", period.startDate);
  }
  const xlsxHref = `/api/reports/cnc-monthly.xlsx?${xlsxParams.toString()}`;

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Mig 053 follow-on (Daksh): this report has a lot of
          columns (one per CNC machine, sometimes split into SFT +
          CFT pairs). The global .page-content cap of 1400px was
          leaving empty space on the right on wider monitors.
          Override the cap just for this page — the JSX <style>
          element unmounts with the component, so it's effectively
          scoped to this route without polluting the rest of the
          app. */}
      <style>{`
        .page-content {
          max-width: none !important;
          padding-left: 16px !important;
          padding-right: 16px !important;
        }
      `}</style>
      <Header period={period} xlsxHref={xlsxHref} />
      <ReportTable report={report} />
      {/* Mig 063 follow-on (Daksh) — electricity bills land late
          (end of month / early next month). The cost calc shifts
          the electricity lookup one month back so a "current
          month" view doesn't sit empty waiting for the bill. */}
      <div
        style={{
          marginTop: 10,
          padding: "8px 12px",
          fontSize: 11,
          color: "var(--muted)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 8,
        }}
      >
        ⚡ <strong style={{ color: "var(--text)" }}>Electricity</strong> uses last month's bill —
        utility bills arrive end-of-month, so the entry you make for
        May feeds into June's cost calc. Tools / labor / maintenance /
        office / other stay on the same month.
      </div>
    </div>
  );
}

function Header({
  period,
  xlsxHref,
}: {
  period: CncReportPeriod;
  xlsxHref: string;
}) {
  // Mig 053 follow-on (Daksh): view toggle + period-aware picker.
  //   Daily   → single date picker
  //   Weekly  → "Week starting Mon" date picker (defaults to the
  //             Monday of the current IST week)
  //   Monthly → existing month + year selects
  // All three submit a GET form so the page stays server-rendered
  // and the URL is bookmarkable.
  const today = new Date();
  const todayYear = today.getFullYear();
  const monthYear = period.year ?? todayYear;
  const years = [monthYear - 1, monthYear, monthYear + 1];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        marginBottom: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          CNC & LATHE Report ·{" "}
          {period.kind === "daily" ? "Daily" : period.kind === "weekly" ? "Weekly" : "Monthly"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
          {period.label}
        </div>
      </div>

      {/* View toggle — three pills. Selected one is filled gold,
          others are outlined. Clicking switches the URL ?view= and
          resets the per-view date param to a sensible default. */}
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999 }}>
        <ViewPill href="/carving/reports?view=daily" label="Daily" active={period.kind === "daily"} />
        <ViewPill href="/carving/reports?view=weekly" label="Weekly" active={period.kind === "weekly"} />
        <ViewPill href="/carving/reports?view=monthly" label="Monthly" active={period.kind === "monthly"} />
      </div>

      {/* Per-view picker form */}
      {period.kind === "daily" && (
        <form
          method="get"
          action="/carving/reports"
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input type="hidden" name="view" value="daily" />
          <input
            type="date"
            name="date"
            defaultValue={period.startDate}
            style={{
              fontSize: 13,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
          <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }}>
            View
          </button>
        </form>
      )}

      {period.kind === "weekly" && (
        <form
          method="get"
          action="/carving/reports"
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input type="hidden" name="view" value="weekly" />
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Week starting Mon</label>
          <input
            type="date"
            name="start"
            defaultValue={period.startDate}
            style={{
              fontSize: 13,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
          <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }}>
            View
          </button>
        </form>
      )}

      {period.kind === "monthly" && (
        <form
          method="get"
          action="/carving/reports"
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input type="hidden" name="view" value="monthly" />
          <select
            name="month"
            defaultValue={period.month ?? today.getMonth() + 1}
            style={{
              fontSize: 13,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            name="year"
            defaultValue={monthYear}
            style={{
              fontSize: 13,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }}>
            View
          </button>
        </form>
      )}

      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <Link
          href={xlsxHref}
          className="primary-button"
          style={{ fontSize: 13, padding: "8px 16px", fontWeight: 700, textDecoration: "none" }}
        >
          ⬇ Download Excel
        </Link>
        <PrintButton style={{ fontSize: 13, padding: "8px 16px", fontWeight: 700 }}>
          🖨 Print
        </PrintButton>
      </div>
    </div>
  );
}

function ViewPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 999,
        textDecoration: "none",
        background: active ? "var(--gold)" : "transparent",
        color: active ? "#fff" : "var(--text)",
        letterSpacing: "0.02em",
        transition: "background 0.12s ease",
      }}
    >
      {label}
    </Link>
  );
}

// Mig 053 follow-on (Daksh): per-CNC-operator tint palette. Each
// vendor gets one of these soft pastels, applied as a background
// to ALL their machine columns (both SFT and CFT) so the table is
// easy to scan visually — "these 3 columns belong to Operator A,
// these 2 to Operator B". Cycles through the palette by vendor
// index in vendorGroups order (alphabetical, so deterministic).
//
// Two tints per slot — `data` is for daily cells (subtle), `header`
// is for the machine code header row (a bit stronger so the column
// grouping is unmistakable). Values use rgba with low alpha so the
// numeric content stays readable in both light + dark themes.
const VENDOR_TINTS: Array<{ data: string; header: string }> = [
  { data: "rgba(201, 161, 74, 0.08)", header: "rgba(201, 161, 74, 0.20)" },  // gold
  { data: "rgba(34, 197, 94, 0.08)",  header: "rgba(34, 197, 94, 0.18)"  },  // green
  { data: "rgba(59, 130, 246, 0.08)", header: "rgba(59, 130, 246, 0.18)" },  // blue
  { data: "rgba(168, 85, 247, 0.08)", header: "rgba(168, 85, 247, 0.18)" },  // purple
  { data: "rgba(249, 115, 22, 0.08)", header: "rgba(249, 115, 22, 0.18)" },  // orange
  { data: "rgba(20, 184, 166, 0.08)", header: "rgba(20, 184, 166, 0.18)" },  // teal
  { data: "rgba(236, 72, 153, 0.08)", header: "rgba(236, 72, 153, 0.18)" },  // pink
];

function ReportTable({ report }: { report: CncMonthlyReport }) {
  if (report.machines.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--muted)",
          background: "var(--surface)",
          borderRadius: 10,
        }}
      >
        No CNC machines configured. Add some in <strong>Carving Jobs → Manage Vendors</strong>.
      </div>
    );
  }

  // Map machine.id → tint pair, derived from vendor index.
  const machineTints = new Map<string, { data: string; header: string }>();
  report.vendorGroups.forEach((g, idx) => {
    const tint = VENDOR_TINTS[idx % VENDOR_TINTS.length];
    for (const m of g.machines) machineTints.set(m.id, tint);
  });
  // Also for the per-operator total row's row-wide background.
  const vendorTints = new Map<string, { data: string; header: string }>();
  report.vendorGroups.forEach((g, idx) => {
    vendorTints.set(g.vendor_id, VENDOR_TINTS[idx % VENDOR_TINTS.length]);
  });

  return (
    <div
      style={{
        overflowX: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <style>{`
        @media print {
          body { background: #fff !important; }
          .sidebar, .topbar, .mobile-nav, .filter-bar { display: none !important; }
          .report-table { font-size: 10px !important; }
        }
      `}</style>
      <table
        className="report-table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      >
        <thead>
          {/* Operator (vendor) row — colspan over each vendor's
              machines. Kept on dark background for prominence, but
              with a small accent border-bottom in the operator's
              tint so the column-group link is unmistakable. */}
          <tr>
            <th style={thLeft()}>DATE</th>
            {report.vendorGroups.map((g) => {
              const cols = g.machines.reduce(
                (n, m) => n + (m.showSqft ? 2 : 1),
                0,
              );
              const tint = vendorTints.get(g.vendor_id);
              return (
                <th
                  key={g.vendor_id}
                  colSpan={cols}
                  style={{
                    ...thBase(),
                    textAlign: "center",
                    background: "#1a1a1a",
                    color: "#fff",
                    // Stronger 3px accent strip in the operator's
                    // tint, so the column group reads as connected
                    // from the dark banner down through the data.
                    borderBottom: `3px solid ${tint?.header ?? "#1a1a1a"}`,
                  }}
                >
                  👷 {g.vendor_name.toUpperCase()}
                </th>
              );
            })}
          </tr>
          {/* Machine code row */}
          <tr>
            <th style={thLeft()}></th>
            {report.vendorGroups.flatMap((g) =>
              g.machines.map((m) => (
                <th
                  key={m.id}
                  colSpan={m.showSqft ? 2 : 1}
                  style={{
                    ...thBase(),
                    textAlign: "center",
                    // Mig 053 follow-on — per-vendor tint on the
                    // machine code header so the column grouping
                    // (operator A | operator B | …) is unmistakable.
                    background:
                      machineTints.get(m.id)?.header ?? "var(--surface-alt)",
                    fontWeight: 700,
                  }}
                >
                  {m.code}
                  {m.type === "lathe" && (
                    <span
                      style={{
                        fontSize: 9,
                        marginLeft: 5,
                        padding: "0 5px",
                        borderRadius: 3,
                        background: "rgba(124,58,237,0.15)",
                        color: "#7c3aed",
                        fontWeight: 800,
                        letterSpacing: "0.05em",
                      }}
                    >
                      LATHE
                    </span>
                  )}
                  {m.type === "multi_head_2" && (
                    <span
                      style={{
                        fontSize: 9,
                        marginLeft: 5,
                        padding: "0 5px",
                        borderRadius: 3,
                        background: "rgba(180,115,51,0.18)",
                        color: "#b45309",
                        fontWeight: 800,
                        letterSpacing: "0.05em",
                      }}
                    >
                      2× HEAD
                    </span>
                  )}
                </th>
              )),
            )}
          </tr>
          {/* Unit row (SFT / CFT). Mig 053 follow-on (Daksh):
              renamed "SQFT" to "SFT" everywhere in the report header.
              Each (slab, machine, day) cell is mutually exclusive —
              a slab is EITHER measured in SFT (thickness ≤ 1 ft) OR
              in CFT (thickness > 1 ft), so the unused side of every
              cell renders as "—". */}
          <tr>
            <th style={thLeft()}></th>
            {report.machines.flatMap((m) => {
              const tint = machineTints.get(m.id);
              const thWithTint: React.CSSProperties = {
                ...thNum(),
                background: tint?.header ?? thNum().background,
              };
              return m.showSqft
                ? [
                    <th key={`${m.id}-sqft`} style={thWithTint}>SFT</th>,
                    <th key={`${m.id}-cft`} style={thWithTint}>CFT</th>,
                  ]
                : [<th key={`${m.id}-cft`} style={thWithTint}>CFT</th>];
            })}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.date}>
              <td style={tdDate()}>{row.date.slice(8)}/{row.date.slice(5, 7)}/{row.date.slice(0, 4)}</td>
              {report.machines.flatMap((m) => {
                const v = row.values[m.id];
                const sqft = v?.sqft ?? 0;
                const cft = v?.cft ?? 0;
                // Mig 053 follow-on — subtle per-operator tint
                // applied to every data cell so the columns are
                // visually grouped by vendor as you scan rows.
                const tint = machineTints.get(m.id)?.data;
                const cellStyle = (strong: boolean): React.CSSProperties => ({
                  ...tdNum(strong),
                  background: tint,
                });
                return m.showSqft
                  ? [
                      <td key={`${m.id}-sqft`} style={cellStyle(sqft > 0)}>
                        {sqft > 0 ? fmt(sqft) : "—"}
                      </td>,
                      <td key={`${m.id}-cft`} style={cellStyle(cft > 0)}>
                        {cft > 0 ? fmt(cft) : "—"}
                      </td>,
                    ]
                  : [
                      <td key={`${m.id}-cft`} style={cellStyle(cft > 0)}>
                        {cft > 0 ? fmt(cft) : "—"}
                      </td>,
                    ];
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* GRAND TOTAL row — per-machine cells pick up their
              operator tint (stronger header version) so the columns
              still read as one block when scanning. */}
          <tr style={{ fontWeight: 700 }}>
            <td style={{ ...tdDate(), background: "var(--surface-alt)" }}>GRAND TOTAL</td>
            {report.machines.flatMap((m) => {
              const p = report.perMachine[m.id]!;
              const tint = machineTints.get(m.id)?.header;
              const totalCell: React.CSSProperties = {
                ...tdNum(true),
                background: tint,
              };
              return m.showSqft
                ? [
                    <td key={`${m.id}-sqft`} style={totalCell}>{fmt(p.sqftTotal)}</td>,
                    <td key={`${m.id}-cft`} style={totalCell}>{fmt(p.cftTotal)}</td>,
                  ]
                : [<td key={`${m.id}-cft`} style={totalCell}>{fmt(p.cftTotal)}</td>];
            })}
          </tr>
          {/* AVG row — same tint treatment as GRAND TOTAL but
              slightly lighter to read as a derived stat. */}
          <tr>
            <td style={{ ...tdDate(), background: "var(--surface-alt)" }}>AVG.</td>
            {report.machines.flatMap((m) => {
              const p = report.perMachine[m.id]!;
              const tint = machineTints.get(m.id)?.data;
              const avgCell: React.CSSProperties = {
                ...tdNum(true),
                background: tint,
              };
              return m.showSqft
                ? [
                    <td key={`${m.id}-sqft`} style={avgCell}>{fmt(p.sqftAvg)}</td>,
                    <td key={`${m.id}-cft`} style={avgCell}>{fmt(p.cftAvg)}</td>,
                  ]
                : [<td key={`${m.id}-cft`} style={avgCell}>{fmt(p.cftAvg)}</td>];
            })}
          </tr>
          {/* Mig 053 follow-on (Daksh): per-CNC-operator total rows.
              Each row sums every machine belonging to that vendor.
              Inserted between AVG and TOTAL so the report reads:
              machine totals → machine avg → operator totals →
              fleet total → MTCPL per-machine avg. */}
          {report.vendorGroups.flatMap((grp) => {
            const v = report.perVendor[grp.vendor_id];
            if (!v) return [];
            // Each operator row picks up its own assigned tint so
            // the column tints + row tint match (visual link).
            const tint = vendorTints.get(grp.vendor_id);
            const machineColCount = report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
            const hasCost = v.operationalForPeriod > 0 || v.depreciationForPeriod > 0;
            return [
              <tr
                key={`vendor-${grp.vendor_id}`}
                style={{ background: tint?.header ?? "rgba(201,161,74,0.10)", fontWeight: 700 }}
              >
                <td style={{ ...tdDate(), background: tint?.header, fontStyle: "italic" }}>
                  ↳ {grp.vendor_name}
                  <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6, fontWeight: 500 }}>
                    {v.machineCount} machine{v.machineCount !== 1 ? "s" : ""} · {v.workingDays} working day{v.workingDays !== 1 ? "s" : ""}
                  </span>
                </td>
                <td colSpan={machineColCount} style={{ ...tdNum(true), textAlign: "left", paddingLeft: 14 }}>
                  <span style={{ marginRight: 18 }}>SFT: <strong>{fmt(v.sqftTotal)}</strong></span>
                  <span style={{ marginRight: 18 }}>CFT: <strong>{fmt(v.cftTotal)}</strong></span>
                  <span style={{ color: "var(--gold-dark)" }}>TOTAL: <strong>{fmt(v.combinedTotal)}</strong></span>
                </td>
              </tr>,
              // Mig 054 — cost sub-row per operator. Only renders
              // when there's something to show (operational > 0 OR
              // depreciation > 0), so vendors without asset/expense
              // data don't clutter the report.
              hasCost ? (
                <tr
                  key={`vendor-cost-${grp.vendor_id}`}
                  style={{ background: tint?.data ?? "rgba(201,161,74,0.05)" }}
                >
                  <td style={{ ...tdDate(), background: tint?.data, fontSize: 10, color: "var(--muted)" }}>
                    &nbsp;&nbsp;💰 COST
                  </td>
                  <td colSpan={machineColCount} style={{ ...tdNum(false), textAlign: "left", paddingLeft: 14, fontSize: 11 }}>
                    <span style={{ marginRight: 14 }}>💸 Operational: <strong>{inr(v.operationalForPeriod)}</strong></span>
                    <span style={{ marginRight: 14 }}>📉 Depreciation: <strong>{inr(v.depreciationForPeriod)}</strong></span>
                    <span style={{ marginRight: 18, color: "var(--gold-dark)" }}>TOTAL: <strong>{inr(v.totalCostForPeriod)}</strong></span>
                    <span style={{ marginRight: 10 }}>·</span>
                    <span style={{ marginRight: 12 }}>₹/SFT: <strong>{inrPrecise(v.costPerSft)}</strong></span>
                    <span style={{ marginRight: 12 }}>₹/CFT: <strong>{inrPrecise(v.costPerCft)}</strong></span>
                    <span>₹/UNIT: <strong>{inrPrecise(v.costPerCombined)}</strong></span>
                  </td>
                </tr>
              ) : null,
            ].filter(Boolean) as React.ReactNode[];
          })}
          {/* TOTAL-AVG fleet row + MTCPL per-machine avg, two consolidated rows.
              Mig 053 follow-on: added combined SFT+CFT total to the
              fleet TOTAL line — single number Daksh can quote when
              comparing months. */}
          <tr style={{ background: "#1a1a1a", color: "#fff", fontWeight: 700 }}>
            <td style={{ ...tdDate(), color: "#fff", borderColor: "#333" }}>
              TOTAL · {report.workingDaysAcrossFleet} working day{report.workingDaysAcrossFleet !== 1 ? "s" : ""}
            </td>
            <td colSpan={report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0)} style={{ ...tdNum(true), color: "#fff", borderColor: "#333", textAlign: "left", paddingLeft: 14 }}>
              <span style={{ marginRight: 18 }}>SFT: <strong>{fmt(report.grandTotalSqft)}</strong></span>
              <span style={{ marginRight: 18 }}>CFT: <strong>{fmt(report.grandTotalCft)}</strong></span>
              <span style={{ color: "#facc15" }}>TOTAL: <strong>{fmt(report.grandTotalCombined)}</strong></span>
            </td>
          </tr>
          {/* Mig 054 — fleet-wide cost row. Sits inside the dark
              fleet-total banner so the headline cost number is
              visible alongside production volume. Yellow accent on
              TOTAL COST mirrors the production row's accent. */}
          {(report.grandTotalOperational > 0 || report.grandTotalDepreciation > 0) && (
            <tr style={{ background: "#1a1a1a", color: "#fff" }}>
              <td style={{ ...tdDate(), color: "#facc15", borderColor: "#333", fontSize: 10 }}>
                &nbsp;&nbsp;💰 FLEET COST
              </td>
              <td colSpan={report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0)} style={{ ...tdNum(true), color: "#fff", borderColor: "#333", textAlign: "left", paddingLeft: 14, fontSize: 11 }}>
                <span style={{ marginRight: 14 }}>💸 Operational: <strong>{inr(report.grandTotalOperational)}</strong></span>
                <span style={{ marginRight: 14 }}>📉 Depreciation: <strong>{inr(report.grandTotalDepreciation)}</strong></span>
                <span style={{ color: "#facc15" }}>TOTAL COST: <strong>{inr(report.grandTotalCost)}</strong></span>
              </td>
            </tr>
          )}
          <tr style={{ background: "var(--surface-alt)", fontWeight: 700 }}>
            <td style={tdDate()}>MTCPL · per-machine AVG</td>
            <td colSpan={report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0)} style={{ ...tdNum(true), textAlign: "left", paddingLeft: 14 }}>
              <span style={{ marginRight: 24 }}>SFT: <strong>{fmt(report.perMachineAvgSqft)}</strong></span>
              <span>CFT: <strong>{fmt(report.perMachineAvgCft)}</strong></span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Cell style helpers ────────────────────────────────────────────

function thBase(): React.CSSProperties {
  return {
    padding: "8px 10px",
    fontSize: 11,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

function thLeft(): React.CSSProperties {
  return { ...thBase(), textAlign: "left", minWidth: 110, position: "sticky", left: 0, zIndex: 1 };
}

function thNum(): React.CSSProperties {
  return { ...thBase(), textAlign: "center", minWidth: 64 };
}

function tdDate(): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 11,
    border: "1px solid var(--border)",
    color: "var(--muted)",
    background: "var(--surface)",
    position: "sticky",
    left: 0,
    fontVariantNumeric: "tabular-nums",
  };
}

function tdNum(strong: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 11,
    border: "1px solid var(--border)",
    textAlign: "right",
    color: strong ? "var(--text)" : "var(--muted-light)",
    fontWeight: strong ? 600 : 400,
    fontVariantNumeric: "tabular-nums",
  };
}
