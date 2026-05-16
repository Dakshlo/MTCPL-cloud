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
import { buildCncMonthlyReport, type CncMonthlyReport } from "@/lib/cnc-monthly-report";
import { PrintButton } from "@/components/print-button";

type Search = Promise<{ year?: string; month?: string }>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0.00";
  return n.toFixed(digits);
}

export default async function CncMonthlyReportPage({ searchParams }: { searchParams: Search }) {
  await requireAuth(["developer", "owner", "carving_head"]);
  const params = await searchParams;
  const today = new Date();
  const year = Number(params.year) || today.getFullYear();
  const month = Math.min(12, Math.max(1, Number(params.month) || today.getMonth() + 1));

  const report = await buildCncMonthlyReport(year, month);

  const xlsxHref = `/api/reports/cnc-monthly.xlsx?year=${year}&month=${month}`;

  return (
    <div style={{ paddingBottom: 32 }}>
      <Header report={report} year={year} month={month} xlsxHref={xlsxHref} />
      <ReportTable report={report} />
    </div>
  );
}

function Header({
  year,
  month,
  xlsxHref,
}: {
  report: CncMonthlyReport;
  year: number;
  month: number;
  xlsxHref: string;
}) {
  // Year + month picker that reloads the page via simple GET nav.
  // Keeps the page server-rendered and bookmarkable.
  const years = [year - 1, year, year + 1];
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
          CNC & LATHE Monthly Report
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
          {MONTH_NAMES[month - 1]} {year}
        </div>
      </div>
      <form
        method="get"
        action="/carving/reports"
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <select
          name="month"
          defaultValue={month}
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
          defaultValue={year}
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
        <button
          type="submit"
          className="ghost-button"
          style={{ fontSize: 12, padding: "6px 14px" }}
        >
          View
        </button>
      </form>
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
          {/* Operator (vendor) row — colspan over each vendor's machines */}
          <tr>
            <th style={thLeft()}>DATE</th>
            {report.vendorGroups.map((g) => {
              const cols = g.machines.reduce(
                (n, m) => n + (m.showSqft ? 2 : 1),
                0,
              );
              return (
                <th
                  key={g.vendor_id}
                  colSpan={cols}
                  style={{
                    ...thBase(),
                    textAlign: "center",
                    background: "#1a1a1a",
                    color: "#fff",
                    borderBottom: "2px solid #1a1a1a",
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
                    background: "var(--surface-alt)",
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
            {report.machines.flatMap((m) =>
              m.showSqft
                ? [
                    <th key={`${m.id}-sqft`} style={thNum()}>SFT</th>,
                    <th key={`${m.id}-cft`} style={thNum()}>CFT</th>,
                  ]
                : [<th key={`${m.id}-cft`} style={thNum()}>CFT</th>],
            )}
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
                return m.showSqft
                  ? [
                      <td key={`${m.id}-sqft`} style={tdNum(sqft > 0)}>
                        {sqft > 0 ? fmt(sqft) : "—"}
                      </td>,
                      <td key={`${m.id}-cft`} style={tdNum(cft > 0)}>
                        {cft > 0 ? fmt(cft) : "—"}
                      </td>,
                    ]
                  : [
                      <td key={`${m.id}-cft`} style={tdNum(cft > 0)}>
                        {cft > 0 ? fmt(cft) : "—"}
                      </td>,
                    ];
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* GRAND TOTAL row */}
          <tr style={{ background: "var(--surface-alt)", fontWeight: 700 }}>
            <td style={tdDate()}>GRAND TOTAL</td>
            {report.machines.flatMap((m) => {
              const p = report.perMachine[m.id]!;
              return m.showSqft
                ? [
                    <td key={`${m.id}-sqft`} style={tdNum(true)}>{fmt(p.sqftTotal)}</td>,
                    <td key={`${m.id}-cft`} style={tdNum(true)}>{fmt(p.cftTotal)}</td>,
                  ]
                : [<td key={`${m.id}-cft`} style={tdNum(true)}>{fmt(p.cftTotal)}</td>];
            })}
          </tr>
          {/* AVG row */}
          <tr style={{ background: "var(--surface-alt)" }}>
            <td style={tdDate()}>AVG.</td>
            {report.machines.flatMap((m) => {
              const p = report.perMachine[m.id]!;
              return m.showSqft
                ? [
                    <td key={`${m.id}-sqft`} style={tdNum(true)}>{fmt(p.sqftAvg)}</td>,
                    <td key={`${m.id}-cft`} style={tdNum(true)}>{fmt(p.cftAvg)}</td>,
                  ]
                : [<td key={`${m.id}-cft`} style={tdNum(true)}>{fmt(p.cftAvg)}</td>];
            })}
          </tr>
          {/* Mig 053 follow-on (Daksh): per-CNC-operator total rows.
              Each row sums every machine belonging to that vendor.
              Inserted between AVG and TOTAL so the report reads:
              machine totals → machine avg → operator totals →
              fleet total → MTCPL per-machine avg. */}
          {report.vendorGroups.map((grp) => {
            const v = report.perVendor[grp.vendor_id];
            if (!v) return null;
            return (
              <tr key={`vendor-${grp.vendor_id}`} style={{ background: "rgba(201,161,74,0.10)", fontWeight: 700 }}>
                <td style={{ ...tdDate(), fontStyle: "italic" }}>
                  ↳ {grp.vendor_name}
                  <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6, fontWeight: 500 }}>
                    {v.machineCount} machine{v.machineCount !== 1 ? "s" : ""} · {v.workingDays} working day{v.workingDays !== 1 ? "s" : ""}
                  </span>
                </td>
                <td colSpan={report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0)} style={{ ...tdNum(true), textAlign: "left", paddingLeft: 14 }}>
                  <span style={{ marginRight: 18 }}>SFT: <strong>{fmt(v.sqftTotal)}</strong></span>
                  <span style={{ marginRight: 18 }}>CFT: <strong>{fmt(v.cftTotal)}</strong></span>
                  <span style={{ color: "var(--gold-dark)" }}>TOTAL: <strong>{fmt(v.combinedTotal)}</strong></span>
                </td>
              </tr>
            );
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
