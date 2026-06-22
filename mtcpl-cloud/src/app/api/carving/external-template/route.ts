import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth";
import { canAddExternalCutSlab } from "@/lib/cutting-permissions";

// Mig 155 — styled template for the EXTERNAL cut-slab import. Mirrors the
// Required Sizes template (/api/slabs/import-template) column-for-column,
// plus a Stock Location column (where the externally-cut slab physically
// sits). Built with exceljs in the Node runtime for reliable cell colours.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function thin(argb: string) {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, bottom: side, left: side, right: side };
}

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) {
    return new Response("Not authorised", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const temple = (searchParams.get("temple") ?? "").trim();
  const stone = (searchParams.get("stone") ?? "").trim();
  const TEMPLATE_ROWS = 30;
  // Total columns (keep parse + template in lockstep — see the external
  // import client's onFile cell-index map).
  const COLS = 14;
  // 1-based column index of the Quality column (last).
  const QUALITY_COL = 14;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("External Slabs");
  ws.columns = [
    { header: "Sr.No.", width: 8 },
    { header: "Temple", width: 24 },
    { header: "Stone", width: 13 },
    { header: "Category 1 (e.g. Floor)", width: 20 },
    { header: "Category 2 (e.g. Cloister)", width: 20 },
    { header: "Label", width: 18 },
    { header: "Description", width: 28 },
    { header: "Additional Description (optional)", width: 26 },
    { header: "Stock Location", width: 18 },
    { header: "Length (in)", width: 11 },
    { header: "Width (in)", width: 11 },
    { header: "Height (in)", width: 11 },
    { header: "Quantity", width: 10 },
    { header: "Quality (A/B/Both)", width: 16 },
  ];
  for (let i = 1; i <= TEMPLATE_ROWS; i++) {
    ws.addRow([i, temple, stone, "", "", "", "", "", "", "", "", "", "", ""]);
  }

  // Header band — brand brown, white bold, centred.
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92400E" } };
    c.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = thin("FF5B2E0A");
  });

  // Body rows — gold pre-filled (Sr.No / Temple / Stone) + light-blue
  // "fill here" columns, with borders.
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    const row = ws.getRow(r);
    row.height = 17;
    for (let col = 1; col <= COLS; col++) {
      const c = row.getCell(col);
      const prefilled = col <= 3;
      // Numeric columns (Sr.No, Length, Width, Height, Quantity) centred.
      const numeric = col === 1 || (col >= 10 && col <= 13);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: prefilled ? "FFFDE9C8" : "FFEAF4FF" } };
      c.font = { name: "Calibri", size: 11, bold: col === 2, color: { argb: prefilled ? "FF7C2D12" : "FF1F2937" } };
      c.alignment = { horizontal: numeric ? "center" : "left", vertical: "middle" };
      c.border = thin(prefilled ? "FFE7C9A0" : "FFC7DEF5");
    }
    // Quality column — dropdown so users pick A / B / Both (blank = Both).
    row.getCell(QUALITY_COL).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"A,B,Both"'],
      showErrorMessage: true,
      errorTitle: "Quality",
      error: "Pick A, B or Both (or leave blank for Both).",
    };
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  const body = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  const safe = `${temple}-${stone}`.replace(/[^a-z0-9]+/gi, "_") || "template";

  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="external-slabs-${safe}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
