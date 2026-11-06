// ──────────────────────────────────────────────────────────────────
// The dispatch raw-data workbook (Daksh, Nov 2026).
//
// Sibling of lib/carving-raw-workbook, deliberately identical in
// shape: split out of the route so the sheet can be generated and
// inspected without going through HTTP — an export that downloads
// fine and then will not open is the worst failure mode, so it has to
// be testable.
//
// Sheet 1 is deliberately plain: ONE header row, then data. No title
// banner, no merged group bands, no totals row — anything above or
// across the header is what stops Excel's "Insert → PivotTable" from
// working, and pivoting is the entire point. Grouping is carried by
// header colour instead. Everything explanatory lives on sheet 2.
//
// ExcelJS, Node runtime. The sheetPr/pageSetup corruption gotcha noted
// in /api/reports/dpr.xlsx is avoided by setting neither.
// ──────────────────────────────────────────────────────────────────

import ExcelJS from "exceljs";

import {
  GROUP_FILL,
  GROUP_LABELS,
  type ColumnKind,
  type DispatchRawExport,
} from "@/lib/dispatch-raw-export";

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

export function buildDispatchRawWorkbook(
  data: DispatchRawExport,
  downloadedBy: string,
): ExcelJS.Workbook {
  const { columns, rows, meta } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "MTCPL Cloud";
  wb.created = new Date();

  // ── Sheet 1: the data, and nothing but the data ────────────────
  const ws = wb.addWorksheet("Dispatched slabs", {
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

  say("Report", "Dispatch raw data — one row per slab, per trip");
  say("Generated", `${istNow} IST`);
  say("Downloaded by", downloadedBy);
  say("Rows", String(meta.rowCount));
  say("Trips", String(meta.tripCount));
  say("Columns", String(columns.length));
  about.addRow([]);

  say(
    "Date range",
    f.from || f.to
      ? `${f.from || "the beginning"} → ${f.to || "today"} (by Dispatched on)`
      : "Everything",
  );
  say("Temple", f.temple || "All");
  say("Stage", f.stage ? f.stage.replace(/_/g, " ") : "All");
  about.addRow([]);

  say(
    "One row =",
    "one slab on one trip. The trip's challan, truck, driver and dates repeat on every slab it carried — which is what a pivot wants. A 40-slab load is 40 rows; sum them to get the load back.",
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
    "Taken as the SMALLEST of the three dimensions, whichever column it was typed into. About a fifth of slabs are entered out of order, so the thickness column alone is not reliable — 'Real thickness' is. Both are given so you can check.",
  );
  say(
    "SFT",
    "The face: the two LARGEST dimensions. 'Thin or thick' tests the real thickness at 12 inches — thin slabs are billed in SFT, thicker ones in CFT.",
  );
  say("Sizes", "All dimensions are in INCHES, despite the database column names.");
  say(
    "Stage",
    "Where the trip got to: Waiting for approval → Invoice in process → On road → Delivered. Returned overrides the rest. One column, so a pivot can answer 'how much is still on the road' without reproducing the board's rules.",
  );
  say(
    "Challan no vs Invoicing challan",
    "The first is the dispatch's own challan (FY-number, what the driver carries). The second is the invoicing challan the office raised from that trip, which becomes the tax invoice. A trip with no invoicing challan yet leaves those columns blank.",
  );
  say(
    "Slab status now",
    "The slab's status TODAY, not at the time of dispatch — useful for finding what has since been installed or cancelled.",
  );
  say("Times", "Shown in IST.");
  say(
    "Not in here",
    "Archived trips, and prices. Rates and amounts live on the invoice; this sheet is about what physically went out.",
  );
  about.addRow([]);

  say(
    "In this file",
    `Temples: ${meta.temples.length} · Stages: ${meta.stages.join(", ") || "—"} · Total CFT: ${meta.totalCft} · Total SFT: ${meta.totalSft}`,
  );

  return wb;
}
