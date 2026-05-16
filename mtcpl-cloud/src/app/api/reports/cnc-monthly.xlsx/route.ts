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
// Mig 053 follow-on (Daksh): use xlsx-js-style (community fork of
// SheetJS) so we can emit per-cell font / fill / border / alignment
// styling. The base xlsx package strips all `s` properties on
// write, which is why the earlier Excel downloads were unstyled.
import * as XLSX from "xlsx-js-style";

// Mig 054 follow-on — force Node runtime + dynamic. xlsx-js-style
// uses Node-only APIs internally (Buffer / fs guards) that crash
// when Vercel infers Edge runtime. force-dynamic also ensures the
// route isn't cached during build.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth";
import {
  buildCncReport,
  cncPeriodFromSearch,
  type CncMonthlyReport,
} from "@/lib/cnc-monthly-report";

// ── Per-operator tint palette (Excel-side mirror of the on-screen
// palette). xlsx fills use solid hex (no alpha), so each on-screen
// tint is pre-flattened against white to a single solid color.
// `data` = subtle background for data cells; `header` = stronger
// background for header / total rows.
const PALETTE: Array<{ data: string; header: string; accent: string }> = [
  { data: "FAF3DF", header: "F1E0B8", accent: "C9A14A" }, // gold
  { data: "EAF8EF", header: "C6EDD3", accent: "22C55E" }, // green
  { data: "E8F0FB", header: "C6DBF6", accent: "3B82F6" }, // blue
  { data: "F2EBFB", header: "DDC4F2", accent: "A855F7" }, // purple
  { data: "FBEAD8", header: "F7C99A", accent: "F97316" }, // orange
  { data: "E1F6F3", header: "B0E1DA", accent: "14B6A6" }, // teal
  { data: "FCE8F2", header: "F4B7D2", accent: "EC4899" }, // pink
];

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
  // Mig 053 follow-on (Daksh): generalized to daily / weekly /
  // monthly via the shared cncPeriodFromSearch helper. Builds the
  // same params bag the page server component reads from.
  const paramsBag: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) paramsBag[k] = v;
  const period = cncPeriodFromSearch(paramsBag);
  const report = await buildCncReport(period);

  const { aoa, layout } = buildSheet(report);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths — date column wide, numeric columns mid.
  ws["!cols"] = [
    { wch: 14 },
    ...report.machines.flatMap((m) =>
      m.showSqft ? [{ wch: 9 }, { wch: 9 }] : [{ wch: 9 }],
    ),
  ];

  // Set a slightly taller header row for the operator + machine rows
  // (so the colour banding is easy to spot).
  ws["!rows"] = [];
  for (let r = 0; r < aoa.length; r++) {
    if (r === 0) ws["!rows"][r] = { hpx: 28 }; // title
    else if (r === layout.operatorRow) ws["!rows"][r] = { hpx: 22 };
    else if (r === layout.machineRow) ws["!rows"][r] = { hpx: 22 };
    else if (r === layout.unitRow) ws["!rows"][r] = { hpx: 18 };
    else ws["!rows"][r] = { hpx: 16 };
  }

  // Merge ranges for the operator + machine header rows.
  ws["!merges"] = buildMerges(report, layout);

  // Mig 053 follow-on (Daksh) — apply per-cell styling so the Excel
  // download matches the on-screen visual identity.
  applyStyles(ws, report, layout);

  const wb = XLSX.utils.book_new();
  // Excel sheet names are capped at 31 chars + can't include certain
  // glyphs. Use a short period code that's always safe.
  const sheetName = sheetNameForPeriod(period);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Mig 054 follow-on — xlsx-js-style returns either a Buffer or
  // Uint8Array depending on the runtime. Normalise to Uint8Array
  // so the Response constructor (Node 20 / undici) doesn't choke
  // on a NodeJS Buffer in some serverless environments.
  const writeOut = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as
    | ArrayBuffer
    | Uint8Array;
  const body =
    writeOut instanceof Uint8Array ? writeOut : new Uint8Array(writeOut);

  const filename = `MTCPL_CNC_${filenameSlugForPeriod(period)}.xlsx`;
  // Cast through BodyInit — Uint8Array is a valid BodyInit at
  // runtime but TS's lib.dom types narrow to a subset that misses
  // it on some Node versions.
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function sheetNameForPeriod(p: { kind: string; label: string }): string {
  // Excel sheet names must be ≤31 chars and avoid: / \ ? * [ ]
  const clean = p.label.replace(/[\/\\?*\[\]:]/g, "-");
  return clean.length > 31 ? clean.slice(0, 31) : clean;
}

function filenameSlugForPeriod(
  p: { kind: string; startDate: string; endDate: string; year?: number; month?: number },
): string {
  if (p.kind === "monthly" && p.year && p.month) {
    return `${p.year}_${pad2(p.month)}`;
  }
  if (p.kind === "weekly") {
    return `week_${p.startDate}`;
  }
  return p.startDate;
}

// Mig 053 follow-on — Sheet layout map. As we push rows we record
// the row index of every section so applyStyles() below can colour
// each section appropriately without re-deriving positions.
type SheetLayout = {
  titleRow: number;
  operatorRow: number;
  machineRow: number;
  unitRow: number;
  dailyRowsStart: number;
  dailyRowsEnd: number;          // inclusive
  grandTotalRow: number;
  avgRow: number;
  perOperatorHeaderRow: number;
  perOperatorRowsStart: number;
  perOperatorRowsEnd: number;    // inclusive
  fleetTotalRow: number;
  fleetAvgRow: number;
  totalNumCols: number;
  /** colIdx → vendor_id, for applying per-operator tints to data
   *  cells. Index 0 (the DATE column) is null. */
  colToVendor: Array<string | null>;
};

// Build a 2D array of cells (rows x cols) representing the sheet,
// plus a layout descriptor for the styling pass.
function buildSheet(report: CncMonthlyReport): {
  aoa: (string | number)[][];
  layout: SheetLayout;
} {
  const rows: (string | number)[][] = [];
  const layout: Partial<SheetLayout> = {};

  // Row 0: Title — uses the period label so daily / weekly /
  // monthly views all render their natural label here.
  const viewLabel =
    report.period.kind === "daily" ? "DAILY" : report.period.kind === "weekly" ? "WEEKLY" : "MONTHLY";
  layout.titleRow = rows.length;
  rows.push([
    `CNC & LATHE SUMMARY (${viewLabel}) — ${report.period.label} · MTCPL`,
  ]);
  rows.push([]); // blank spacer

  // Header rows: operator | machine | unit
  // Compute col-widths first so we can pad headers.
  const totalNumCols = report.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);

  // Operator row (vendor names across each vendor's machine columns)
  layout.operatorRow = rows.length;
  const opRow: (string | number)[] = ["DATE"];
  for (const g of report.vendorGroups) {
    const cols = g.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
    opRow.push(`👷 ${g.vendor_name.toUpperCase()}`);
    for (let i = 1; i < cols; i++) opRow.push("");
  }
  rows.push(opRow);

  // Machine code row
  layout.machineRow = rows.length;
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
  layout.unitRow = rows.length;
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
  layout.dailyRowsStart = rows.length;
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
  layout.dailyRowsEnd = rows.length - 1;

  rows.push([]); // spacer

  // GRAND TOTAL row
  layout.grandTotalRow = rows.length;
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
  layout.avgRow = rows.length;
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

  // Mig 053 follow-on (Daksh): per-CNC-operator total block.
  // One row per vendor, summed across the machines they own.
  // Mig 054: cost columns appended on the right.
  layout.perOperatorHeaderRow = rows.length;
  rows.push([
    "PER OPERATOR TOTALS",
    "MACHINES", "WORKING DAYS", "SFT", "CFT", "TOTAL (SFT+CFT)",
    "OPERATIONAL (Rs.)", "DEPRECIATION (Rs.)", "TOTAL COST (Rs.)",
    "Rs./SFT", "Rs./CFT", "Rs./UNIT",
  ]);
  layout.perOperatorRowsStart = rows.length;
  for (const grp of report.vendorGroups) {
    const v = report.perVendor[grp.vendor_id];
    if (!v) continue;
    rows.push([
      `↳ ${grp.vendor_name}`,
      v.machineCount,
      v.workingDays,
      fmtCell(v.sqftTotal),
      fmtCell(v.cftTotal),
      fmtCell(v.combinedTotal),
      fmtCell(v.operationalForPeriod),
      fmtCell(v.depreciationForPeriod),
      fmtCell(v.totalCostForPeriod),
      fmtCell(v.costPerSft),
      fmtCell(v.costPerCft),
      fmtCell(v.costPerCombined),
    ]);
  }
  layout.perOperatorRowsEnd = rows.length - 1;

  rows.push([]); // spacer

  // Fleet total + per-machine avg as two summary rows that sit
  // beneath the per-machine numeric grid. Mig 053 follow-on: added
  // combined SFT+CFT total. Mig 054: added cost totals at the
  // right of the same row.
  layout.fleetTotalRow = rows.length;
  rows.push([
    `TOTAL · ${report.workingDaysAcrossFleet} working day${report.workingDaysAcrossFleet !== 1 ? "s" : ""}`,
    "SFT", fmtCell(report.grandTotalSqft),
    "CFT", fmtCell(report.grandTotalCft),
    "TOTAL (SFT+CFT)", fmtCell(report.grandTotalCombined),
    "OPERATIONAL", fmtCell(report.grandTotalOperational),
    "DEPRECIATION", fmtCell(report.grandTotalDepreciation),
    "TOTAL COST", fmtCell(report.grandTotalCost),
  ]);
  layout.fleetAvgRow = rows.length;
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

  // Compute the colToVendor mapping (column index → vendor_id, for
  // the styling pass to look up which operator owns each numeric
  // column).
  const colToVendor: Array<string | null> = [null];
  for (const m of report.machines) {
    if (m.showSqft) {
      colToVendor.push(m.vendor_id, m.vendor_id);
    } else {
      colToVendor.push(m.vendor_id);
    }
  }

  // Every layout slot is populated above as we pushed each section;
  // cast through `unknown` to satisfy the type checker (Partial→full
  // narrowing isn't automatic).
  const fullLayout: SheetLayout = {
    ...(layout as Required<Omit<SheetLayout, "totalNumCols" | "colToVendor">>),
    totalNumCols,
    colToVendor,
  };
  return { aoa: rows, layout: fullLayout };
}

// Operator row needs colspan-equivalent merges on the first header
// row so each vendor name spans across its machines' cells. Same
// for the machine code row (each machine_code cell merges its
// SFT + CFT pair).
function buildMerges(report: CncMonthlyReport, layout: SheetLayout): XLSX.Range[] {
  const merges: XLSX.Range[] = [];
  // Title row spans the entire sheet.
  merges.push({
    s: { r: layout.titleRow, c: 0 },
    e: { r: layout.titleRow, c: layout.totalNumCols },
  });

  // Operator row — colspan across each vendor's machine columns.
  let col = 1;
  for (const g of report.vendorGroups) {
    const cols = g.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
    if (cols > 1) {
      merges.push({
        s: { r: layout.operatorRow, c: col },
        e: { r: layout.operatorRow, c: col + cols - 1 },
      });
    }
    col += cols;
  }

  // Machine code row — colspan SFT/CFT pair per machine.
  let mcol = 1;
  for (const m of report.machines) {
    if (m.showSqft) {
      merges.push({
        s: { r: layout.machineRow, c: mcol },
        e: { r: layout.machineRow, c: mcol + 1 },
      });
      mcol += 2;
    } else {
      mcol += 1;
    }
  }

  return merges;
}

// ── Per-cell styling pass (Mig 053 follow-on, Daksh) ─────────────
// Walks the assembled worksheet and writes a `s` style object on
// every cell to match the on-screen visual identity:
//   • Title — dark band, bold white text, large
//   • Operator row — dark band per vendor with a strong accent
//     border-bottom in the vendor's tint
//   • Machine row — header tint per vendor
//   • Unit row (SFT/CFT) — header tint per vendor
//   • Daily data — subtle vendor tint, right-aligned mono
//   • GRAND TOTAL / per-operator rows — header tint, bold
//   • AVG / fleet TOTAL / per-machine AVG — accents
function applyStyles(
  ws: XLSX.WorkSheet,
  report: CncMonthlyReport,
  layout: SheetLayout,
): void {
  const vendorPalette = new Map<string, (typeof PALETTE)[number]>();
  report.vendorGroups.forEach((g, i) => {
    vendorPalette.set(g.vendor_id, PALETTE[i % PALETTE.length]);
  });

  const ensureCell = (r: number, c: number) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) {
      ws[addr] = { v: "", t: "s" };
    }
    return ws[addr];
  };

  const setStyle = (r: number, c: number, style: XLSX.CellStyle) => {
    const cell = ensureCell(r, c);
    cell.s = { ...(cell.s ?? {}), ...style };
  };

  const borderThin = (rgb = "D4D4D4") => ({
    top:    { style: "thin" as const, color: { rgb } },
    bottom: { style: "thin" as const, color: { rgb } },
    left:   { style: "thin" as const, color: { rgb } },
    right:  { style: "thin" as const, color: { rgb } },
  });

  // 1. Title row (row 0) — dark gold banner, white bold text.
  for (let c = 0; c <= layout.totalNumCols; c++) {
    setStyle(layout.titleRow, c, {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
      fill: { fgColor: { rgb: "1A1A1A" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    });
  }

  // 2. Operator row — dark bg, white text, accent border-bottom in
  //    the vendor's tint so the column-group reads as connected.
  let opCol = 1;
  for (const g of report.vendorGroups) {
    const tint = vendorPalette.get(g.vendor_id)!;
    const cols = g.machines.reduce((n, m) => n + (m.showSqft ? 2 : 1), 0);
    for (let c = opCol; c < opCol + cols; c++) {
      setStyle(layout.operatorRow, c, {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
        fill: { fgColor: { rgb: "1A1A1A" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          ...borderThin("333333"),
          bottom: { style: "medium" as const, color: { rgb: tint.accent } },
        },
      });
    }
    opCol += cols;
  }
  // "DATE" cell on operator row — surface bg.
  setStyle(layout.operatorRow, 0, {
    font: { bold: true, color: { rgb: "333333" }, sz: 11 },
    fill: { fgColor: { rgb: "F4F1EA" }, patternType: "solid" },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  });

  // 3. Machine row — per-vendor header tint.
  for (let c = 1; c <= layout.totalNumCols; c++) {
    const vid = layout.colToVendor[c];
    const tint = vid ? vendorPalette.get(vid) : null;
    setStyle(layout.machineRow, c, {
      font: { bold: true, color: { rgb: "1F2937" }, sz: 11 },
      fill: { fgColor: { rgb: tint?.header ?? "F4F1EA" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderThin(),
    });
  }
  setStyle(layout.machineRow, 0, {
    fill: { fgColor: { rgb: "F4F1EA" }, patternType: "solid" },
    border: borderThin(),
  });

  // 4. Unit row (SFT / CFT) — same header tint, slightly lighter
  //    font weight.
  for (let c = 1; c <= layout.totalNumCols; c++) {
    const vid = layout.colToVendor[c];
    const tint = vid ? vendorPalette.get(vid) : null;
    setStyle(layout.unitRow, c, {
      font: { bold: true, color: { rgb: "374151" }, sz: 10 },
      fill: { fgColor: { rgb: tint?.header ?? "F4F1EA" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderThin(),
    });
  }
  setStyle(layout.unitRow, 0, {
    fill: { fgColor: { rgb: "F4F1EA" }, patternType: "solid" },
    border: borderThin(),
  });

  // 5. Daily data cells — subtle vendor tint, right-aligned mono.
  for (let r = layout.dailyRowsStart; r <= layout.dailyRowsEnd; r++) {
    // Date column
    setStyle(r, 0, {
      font: { color: { rgb: "525252" }, sz: 10 },
      fill: { fgColor: { rgb: "FAFAF9" }, patternType: "solid" },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderThin(),
    });
    for (let c = 1; c <= layout.totalNumCols; c++) {
      const vid = layout.colToVendor[c];
      const tint = vid ? vendorPalette.get(vid) : null;
      setStyle(r, c, {
        font: { color: { rgb: "1F2937" }, sz: 10 },
        fill: { fgColor: { rgb: tint?.data ?? "FFFFFF" }, patternType: "solid" },
        alignment: { horizontal: "right", vertical: "center" },
        border: borderThin("E5E7EB"),
      });
    }
  }

  // 6. GRAND TOTAL row — bold, header tint per vendor.
  setStyle(layout.grandTotalRow, 0, {
    font: { bold: true, color: { rgb: "1F2937" }, sz: 11 },
    fill: { fgColor: { rgb: "E5E7EB" }, patternType: "solid" },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  });
  for (let c = 1; c <= layout.totalNumCols; c++) {
    const vid = layout.colToVendor[c];
    const tint = vid ? vendorPalette.get(vid) : null;
    setStyle(layout.grandTotalRow, c, {
      font: { bold: true, color: { rgb: "1F2937" }, sz: 11 },
      fill: { fgColor: { rgb: tint?.header ?? "E5E7EB" }, patternType: "solid" },
      alignment: { horizontal: "right", vertical: "center" },
      border: borderThin(),
    });
  }

  // 7. AVG row — subtle vendor tint.
  setStyle(layout.avgRow, 0, {
    font: { color: { rgb: "525252" }, sz: 11 },
    fill: { fgColor: { rgb: "F4F1EA" }, patternType: "solid" },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  });
  for (let c = 1; c <= layout.totalNumCols; c++) {
    const vid = layout.colToVendor[c];
    const tint = vid ? vendorPalette.get(vid) : null;
    setStyle(layout.avgRow, c, {
      font: { color: { rgb: "374151" }, sz: 10 },
      fill: { fgColor: { rgb: tint?.data ?? "F4F1EA" }, patternType: "solid" },
      alignment: { horizontal: "right", vertical: "center" },
      border: borderThin(),
    });
  }

  // 8. PER OPERATOR TOTALS header. Mig 054: extended from 6 to 12
  //    columns to include OPERATIONAL / DEPRECIATION / TOTAL COST
  //    + ₹/SFT / ₹/CFT / ₹/UNIT. Cost columns 6-11 use a gold
  //    accent on the dark band so the eye splits "production
  //    volume" from "money" visually.
  for (let c = 0; c <= 11; c++) {
    setStyle(layout.perOperatorHeaderRow, c, {
      font: { bold: true, color: { rgb: c >= 6 ? "FACC15" : "FFFFFF" }, sz: 11 },
      fill: { fgColor: { rgb: "1A1A1A" }, patternType: "solid" },
      alignment: { horizontal: c === 0 ? "left" : "center", vertical: "center" },
      border: borderThin(),
    });
  }

  // 9. Per-operator rows — each row uses that operator's header tint
  //    as background so the row pops in the vendor's signature
  //    colour. Cost columns (6-11) get a gold accent tint so the
  //    money columns stand apart from production volume.
  for (let i = 0; i < report.vendorGroups.length; i++) {
    const g = report.vendorGroups[i];
    const tint = vendorPalette.get(g.vendor_id)!;
    const r = layout.perOperatorRowsStart + i;
    setStyle(r, 0, {
      font: { bold: true, italic: true, color: { rgb: "1F2937" }, sz: 11 },
      fill: { fgColor: { rgb: tint.header }, patternType: "solid" },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderThin(),
    });
    // Production columns 1-5: operator-tint background.
    for (let c = 1; c <= 5; c++) {
      setStyle(r, c, {
        font: { bold: c >= 3, color: { rgb: "1F2937" }, sz: 11 },
        fill: { fgColor: { rgb: tint.header }, patternType: "solid" },
        alignment: { horizontal: c <= 2 ? "center" : "right", vertical: "center" },
        border: borderThin(),
      });
    }
    // Cost columns 6-11: gold-accent background. Distinguishes
    // "money" from "production volume" in the wide row.
    for (let c = 6; c <= 11; c++) {
      setStyle(r, c, {
        font: { bold: c === 8 || c === 11, color: { rgb: "7C2D12" }, sz: 11 },
        fill: { fgColor: { rgb: "F1E0B8" }, patternType: "solid" },
        alignment: { horizontal: "right", vertical: "center" },
        border: borderThin(),
      });
    }
  }

  // 10. Fleet TOTAL — dark band, gold combined total accent.
  //     Mig 054: extends from 6 to 12 columns adding OPERATIONAL /
  //     DEPRECIATION / TOTAL COST cells. Cost columns also yellow
  //     for visual link with the per-operator block above.
  setStyle(layout.fleetTotalRow, 0, {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
    fill: { fgColor: { rgb: "1A1A1A" }, patternType: "solid" },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin("333333"),
  });
  // c 1-5 = production half (same yellow-on-dark as before for the
  //          combined total).
  // c 6-11 = cost half (gold/yellow on dark — money is yellow).
  for (let c = 1; c <= 11; c++) {
    const isCombinedTotal = c === 5;
    const isCostLabel = c === 6 || c === 8 || c === 10;
    const isCostValue = c === 7 || c === 9 || c === 11;
    setStyle(layout.fleetTotalRow, c, {
      font: {
        bold: true,
        color: {
          rgb:
            isCombinedTotal || isCostValue
              ? "FACC15"
              : isCostLabel
                ? "F1E0B8"
                : "FFFFFF",
        },
        sz: 11,
      },
      fill: { fgColor: { rgb: "1A1A1A" }, patternType: "solid" },
      alignment: { horizontal: c % 2 === 1 ? "right" : "left", vertical: "center" },
      border: borderThin("333333"),
    });
  }

  // 11. Fleet AVG (MTCPL · per-machine avg) — gold-tinted accent row.
  setStyle(layout.fleetAvgRow, 0, {
    font: { bold: true, color: { rgb: "1F2937" }, sz: 11 },
    fill: { fgColor: { rgb: "F1E0B8" }, patternType: "solid" },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  });
  for (let c = 1; c <= 4; c++) {
    setStyle(layout.fleetAvgRow, c, {
      font: { bold: c % 2 === 0, color: { rgb: "1F2937" }, sz: 11 },
      fill: { fgColor: { rgb: "F1E0B8" }, patternType: "solid" },
      alignment: { horizontal: c % 2 === 1 ? "right" : "left", vertical: "center" },
      border: borderThin(),
    });
  }
}
