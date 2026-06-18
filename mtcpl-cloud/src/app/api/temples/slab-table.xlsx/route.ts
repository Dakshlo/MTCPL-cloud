// ──────────────────────────────────────────────────────────────────
// POST /api/temples/slab-table.xlsx — export a Temple View slab leaf as
// an Excel file. Mirrors the on-screen table: 8 read-only columns + a
// blank "Check" column (for hand-marking on the printed sheet) + Remark.
// Rows are tinted by stage (same colour scheme). Page setup is LANDSCAPE
// + fit-to-ONE-page-wide so all columns print across the page horizontally
// (it may run onto multiple pages top-to-bottom, never sideways).
//
// Data is POSTed from the client (already loaded on the page) so no
// re-query / migration dependency. Auth-gated to any signed-in user.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = {
  code: string; cat1: string; cat2: string; label: string; description: string;
  additional: string; dims: string; stage: string; color: string; remark: string;
};

const HEADERS = ["Code", "Category 1", "Category 2", "Label", "Description", "Add'l description", "Dimensions", "Stage", "Check", "Remark"];
const WIDTHS = [16, 16, 16, 16, 24, 20, 20, 16, 10, 26];

function thinBorder() {
  const s = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
  return { top: s, bottom: s, left: s, right: s };
}
function solidArgb(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  return m ? `FF${m[1].toUpperCase()}` : null;
}
function lightArgb(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return null;
  const h = m[1];
  const blend = (c: number) => Math.round(255 - (255 - c) * 0.14); // ~14% tint toward white
  const to2 = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `FF${to2(blend(parseInt(h.slice(0, 2), 16)))}${to2(blend(parseInt(h.slice(2, 4), 16)))}${to2(blend(parseInt(h.slice(4, 6), 16)))}`;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { title?: string; rows?: ExportRow[] } | null;
  const title = String(body?.title || "Slab list");
  const rows = Array.isArray(body?.rows) ? body!.rows! : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Slabs", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,   // all columns on one page WIDE
      fitToHeight: 0,  // any number of pages TALL
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: "frozen", ySplit: 2 }], // freeze the title + header rows
  });

  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1 — small-font title (the breadcrumb path), merged across all columns.
  ws.mergeCells(1, 1, 1, HEADERS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { size: 9, italic: true, color: { argb: "FF666666" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 14;

  // Row 2 — header.
  const headerRow = ws.getRow(2);
  headerRow.values = HEADERS;
  headerRow.height = 22;
  headerRow.eachCell((c) => {
    c.font = { bold: true, size: 9, color: { argb: "FF1F2937" } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    c.border = thinBorder();
  });

  // Data rows from row 3.
  let r = 3;
  for (const row of rows) {
    const xr = ws.getRow(r);
    xr.values = [row.code, row.cat1, row.cat2, row.label, row.description, row.additional, row.dims, row.stage, "", row.remark];
    const tint = lightArgb(row.color);
    xr.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { size: 9 };
      c.alignment = { vertical: "middle", wrapText: true };
      c.border = thinBorder();
      if (tint) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      if (col === 1) c.font = { size: 9, bold: true }; // code
    });
    // Stage cell — solid stage colour, white bold text.
    const solid = solidArgb(row.color);
    if (solid) {
      const sc = xr.getCell(8);
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: solid } };
      sc.font = { size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      sc.alignment = { vertical: "middle", horizontal: "center" };
    }
    r += 1;
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = title.replace(/[^\w]+/g, "-").slice(0, 60) || "slab-list";
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
