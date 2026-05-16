/**
 * GET /api/reports/cnc-monthly.xlsx?year=2026&month=5
 *
 * Returns the same monthly CNC + lathe summary the HTML report
 * page renders, but as a downloadable Excel workbook formatted
 * close to the paper sheet the office uses today:
 *
 *   • Operator (vendor) names span across each operator's machines.
 *   • Each non-lathe machine has SFT + CFT columns; lathes only
 *     have a single CFT column.
 *   • Each value is either SFT (slab thickness ≤ 1 ft) OR CFT
 *     (thickness > 1 ft) — mutually exclusive. The unused side of
 *     every cell renders as "—" (mig 053 follow-on, Daksh).
 *   • Daily rows for the whole month, then GRAND TOTAL / AVG /
 *     TOTAL-AVG / per-machine avg footer rows.
 */

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { buildCncMonthlyReport, type CncMonthlyReport } from "@/lib/cnc-monthly-report";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtCell(n: number): number | string {
  // Mig 053 follow-on (Daksh): empty cells render as "—" instead of
  // blank. Matches the on-screen report and makes "no work / not the
  // right unit for this slab" visually clear in the Excel grid.
  if (!isFinite(n) || n === 0) return "—";
  // Two-decimal numeric value — Excel will render as 4.37 etc.
  return Number(n.toFixed(2));
}

export async function GET(req: NextRequest) {
  await requireAuth(["developer", "owner", "carving_head"]);

  const { searchParams } = new URL(req.url);
  const today = new Date();
  const year = Number(searchParams.get("year")) || today.getFullYear();
  const month = Math.min(12, Math.max(1, Number(searchParams.get("month")) || today.getMonth() + 1));

  const report = await buildCncMonthlyReport(year, month);

  const aoa = buildSheet(report);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths — date column wide, numeric columns mid.
  ws["!cols"] = [
    { wch: 14 },
    ...report.machines.flatMap((m) =>
      m.showSqft ? [{ wch: 9 }, { wch: 9 }] : [{ wch: 9 }],
    ),
  ];

  // Merge ranges for the operator + machine header rows.
  ws["!merges"] = buildMerges(report);

  // Style numeric cells as 2-decimal numbers. xlsx open source can't
  // do styling — but rounding at value level keeps Excel's display
  // consistent.

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${MONTH_NAMES[month - 1]} ${year}`);

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const filename = `MTCPL_CNC_${year}_${pad2(month)}.xlsx`;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Build a 2D array of cells (rows x cols) representing the sheet.
function buildSheet(report: CncMonthlyReport): (string | number)[][] {
  const rows: (string | number)[][] = [];

  // Row 0: Title — "CNC & LATHE — Month YYYY · MTCPL"
  rows.push([
    `CNC & LATHE SUMMARY — ${MONTH_NAMES[report.month - 1]} ${report.year} · MTCPL`,
  ]);
  rows.push([]); // blank spacer

  // Header rows: operator | machine | unit
  // Compute col-widths first so we can pad headers.
  const totalNumCols = report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);

  // Operator row (vendor names across each vendor's machine columns)
  const opRow: (string | number)[] = ["DATE"];
  for (const g of report.vendorGroups) {
    const cols = g.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
    opRow.push(`👷 ${g.vendor_name.toUpperCase()}`);
    for (let i = 1; i < cols; i++) opRow.push("");
  }
  rows.push(opRow);

  // Machine code row
  const machineRow: (string | number)[] = [""];
  for (const g of report.vendorGroups) {
    for (const m of g.machines) {
      const label = m.type === "lathe" ? `${m.code} (LATHE)`
        : m.type === "multi_head_2" ? `${m.code} (2× HEAD)`
        : m.code;
      machineRow.push(label);
      if (m.showSqft) machineRow.push("");
    }
  }
  rows.push(machineRow);

  // Unit row (SFT / CFT). Mig 053 follow-on (Daksh): renamed
  // "SQFT" to "SFT" in the Excel header to match the on-screen
  // report. Each cell value is either SFT or CFT (mutually
  // exclusive based on slab thickness — see cnc-monthly-report.ts).
  const unitRow: (string | number)[] = [""];
  for (const m of report.machines) {
    if (m.showSqft) {
      unitRow.push("SFT");
      unitRow.push("CFT");
    } else {
      unitRow.push("CFT");
    }
  }
  rows.push(unitRow);

  // Daily rows
  for (const r of report.rows) {
    const row: (string | number)[] = [r.date];
    for (const m of report.machines) {
      const v = r.values[m.id];
      const sqft = v?.sqft ?? 0;
      const cft = v?.cft ?? 0;
      if (m.showSqft) {
        row.push(fmtCell(sqft));
        row.push(fmtCell(cft));
      } else {
        row.push(fmtCell(cft));
      }
    }
    rows.push(row);
  }

  rows.push([]); // spacer

  // GRAND TOTAL row
  const totalRow: (string | number)[] = ["GRAND TOTAL"];
  for (const m of report.machines) {
    const p = report.perMachine[m.id]!;
    if (m.showSqft) {
      totalRow.push(fmtCell(p.sqftTotal));
      totalRow.push(fmtCell(p.cftTotal));
    } else {
      totalRow.push(fmtCell(p.cftTotal));
    }
  }
  rows.push(totalRow);

  // AVG row
  const avgRow: (string | number)[] = ["AVG (per working day)"];
  for (const m of report.machines) {
    const p = report.perMachine[m.id]!;
    if (m.showSqft) {
      avgRow.push(fmtCell(p.sqftAvg));
      avgRow.push(fmtCell(p.cftAvg));
    } else {
      avgRow.push(fmtCell(p.cftAvg));
    }
  }
  rows.push(avgRow);

  rows.push([]); // spacer

  // Fleet total + per-machine avg as two summary rows that sit
  // beneath the per-machine numeric grid.
  rows.push([
    `TOTAL · ${report.workingDaysAcrossFleet} working day${report.workingDaysAcrossFleet !== 1 ? "s" : ""}`,
    "SFT", fmtCell(report.grandTotalSqft),
    "CFT", fmtCell(report.grandTotalCft),
  ]);
  rows.push([
    "MTCPL · per-machine avg",
    "SFT", fmtCell(report.perMachineAvgSqft),
    "CFT", fmtCell(report.perMachineAvgCft),
  ]);

  // Pad rows to the same column count so SheetJS emits a clean grid.
  const targetCols = totalNumCols + 1;
  for (const r of rows) {
    while (r.length < targetCols) r.push("");
  }
  return rows;
}

// Operator row needs colspan-equivalent merges on the first header
// row so each vendor name spans across its machines' cells. Same
// for the machine code row (each machine_code cell merges its
// SQFT + CFT pair).
function buildMerges(report: CncMonthlyReport): XLSX.Range[] {
  const merges: XLSX.Range[] = [];
  // Title row spans the entire sheet.
  const totalNumCols = report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalNumCols } });

  // Operator row is row index 2 (after title + spacer).
  let col = 1;
  for (const g of report.vendorGroups) {
    const cols = g.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
    if (cols > 1) merges.push({ s: { r: 2, c: col }, e: { r: 2, c: col + cols - 1 } });
    col += cols;
  }

  // Machine code row is row index 3.
  let mcol = 1;
  for (const m of report.machines) {
    if (m.showSqft) {
      merges.push({ s: { r: 3, c: mcol }, e: { r: 3, c: mcol + 1 } });
      mcol += 2;
    } else {
      mcol += 1;
    }
  }

  return merges;
}
