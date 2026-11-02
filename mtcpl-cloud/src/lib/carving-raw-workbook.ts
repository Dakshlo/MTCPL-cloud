// ──────────────────────────────────────────────────────────────────
// The CNC raw-data workbook (Daksh, Nov 2026).
//
// Split out of the route so the sheet can be generated and inspected
// without going through HTTP — an export that downloads fine and then
// will not open is the worst failure mode, so it has to be testable.
//
// Sheet 1 is deliberately plain: ONE header row, then data. No title
// banner, no merged group bands, no totals row — anything above or
// across the header is what stops Excel's "Insert → PivotTable" from
// working, and pivoting is the entire point. Grouping is carried by
// header colour instead. Everything explanatory lives on sheet 2.
//
// ExcelJS, Node runtime — same choice as the other styled exports
// (/api/accounts/vendor-outstanding-export). The sheetPr/pageSetup
// corruption gotcha noted in /api/reports/dpr.xlsx is avoided by
// setting neither.
// ──────────────────────────────────────────────────────────────────

import ExcelJS from "exceljs";

import {
  GROUP_FILL,
  GROUP_LABELS,
  type CarvingRawExport,
  type ColumnKind,
} from "@/lib/carving-raw-export";

/** Indian lakh/crore grouping, matching the other finance exports. */
const MONEY_FMT = '[>=10000000]##,##,##,##0.00;[>=100000]##,##,##0.00;##,##0.00';

function numFmt(kind: ColumnKind, dp?: number): string | undefined {
  switch (kind) {
    case "money":
      return MONEY_FMT;
    case "date":
      return "dd-mm-yyyy hh:mm";
    case "day":
      return "dd-mm-yyyy";
    case "number":
      return dp === 0 ? "0" : dp === 3 ? "0.000" : "0.00";
    default:
      return undefined;
  }
}

/**
 * Strip control characters. Free text typed on the floor (and pasted
 * from WhatsApp) can carry them, and Excel refuses to open a workbook
 * that contains one — the file downloads fine and then will not open.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: string): string => s.replace(CONTROL_CHARS, " ").trim();

export function buildCarvingRawWorkbook(
  data: CarvingRawExport,
  downloadedBy: string,
): ExcelJS.Workbook {
  const { columns, rows, meta } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "MTCPL Cloud";
  wb.created = new Date();

  // ── Sheet 1: the data, and nothing but the data ────────────────
  const ws = wb.addWorksheet("CNC jobs", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });

  ws.columns = columns.map((c) => ({ width: c.width }));

  const header = ws.addRow(columns.map((c) => c.header));
  header.height = 30;
  header.eachCell((cell, i) => {
    const col = columns[i - 1];
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: GROUP_FILL[col.group] },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  for (const r of rows) {
    const row = ws.addRow(r.map((v) => (typeof v === "string" ? clean(v) : v)));
    row.eachCell({ includeEmpty: false }, (cell, i) => {
      const col = columns[i - 1];
      if (!col) return;
      const fmt = numFmt(col.kind, col.dp);
      if (fmt) cell.numFmt = fmt;
      cell.font = { size: 10 };
      if (col.kind === "number" || col.kind === "money") {
        cell.alignment = { horizontal: "right" };
      }
    });
  }

  // Autofilter across the whole header — the first thing anyone will
  // reach for, and it has to span every column to be useful.
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }

  // ── Sheet 2: what this is ──────────────────────────────────────
  const about = wb.addWorksheet("About");
  about.columns = [{ width: 26 }, { width: 86 }];

  const say = (k: string, v: string) => {
    const r = about.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10 };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  };

  const f = meta.filters;
  const istNow = new Date(meta.generatedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  say("Report", "CNC / carving raw data — one row per carving job");
  say("Generated", `${istNow} IST`);
  say("Downloaded by", downloadedBy);
  say("Rows", String(meta.rowCount));
  say("Columns", String(columns.length));
  about.addRow([]);

  say(
    "Date range",
    f.from || f.to
      ? `${f.from || "the beginning"} → ${f.to || "today"} (by Assigned at)`
      : "Everything",
  );
  say("Temple", f.temple || "All");
  say("Operator / vendor", f.vendor || "All");
  say("Job status", f.status || "All");
  about.addRow([]);

  say(
    "One row =",
    "one slab's trip through one machine. A slab carved twice appears twice — that is the raw grain. Pivot to collapse it.",
  );
  say(
    "Column groups",
    Object.entries(GROUP_LABELS)
      .map(([k, label]) => `${label} (${columns.filter((c) => c.group === k).length})`)
      .join(" · "),
  );
  about.addRow([]);

  say(
    "CFT and SFT",
    "Not stored anywhere — both are calculated here using the same rule invoicing bills with, so this sheet and your invoices agree.",
  );
  say(
    "Thickness",
    "Taken as the SMALLEST of the three dimensions, whichever column it was typed into. About a fifth of slabs are entered out of order, so the thickness column alone is not reliable — the 'Real thickness' column is.",
  );
  say(
    "SFT",
    "The face: the two LARGEST dimensions. 'Thin or thick' tests the real thickness at 12 inches — thin slabs are measured in SFT, thicker ones in CFT.",
  );
  say("Sizes", "All dimensions are in INCHES, despite the database column names.");
  say(
    "Times",
    "Shown in IST. 'Hours on machine' is Unloaded minus Loaded, blank where either is missing.",
  );
  say(
    "Machine",
    "The machine the job was actually done on — this is the column to pivot by. 'Currently on machine' is different: it only fills for jobs loaded on a machine right now, because that pointer is cleared the moment a slab comes off.",
  );
  say(
    "Jobwork money",
    "Only fills for the Outsource lane (an outside carver paid per CFT/SFT). CNC jobs done in-house carry no rate, so these columns are blank on most rows.",
  );
  about.addRow([]);

  say(
    "In this file",
    `Temples: ${meta.temples.length} · Operators: ${meta.vendors.length} · Statuses: ${meta.statuses.join(", ") || "—"}`,
  );

  return wb;
}
