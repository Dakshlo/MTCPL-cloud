// ──────────────────────────────────────────────────────────────────
// POST /api/temples/master-excel.xlsx — the "Master Excel".
//
// The client (Temple View card browser) lets the user tick category cards
// down to the Label level (Category 1 / Category 2 / Label — no deeper),
// then POSTs every slab under the selection here. Each slab still carries
// its full ordered band `path`
// (Category 1 › Category 2 › Label › Description › Additional). We render
// NESTED GROUP BANDS — each path segment becomes an indented heading band,
// HIGHLIGHTED by depth (a strong dark Category-1 band stepping down to
// lighter tints) and wired as collapsible outline groups so a category can
// be folded away. Slabs sit under their deepest band with Code · Dimensions ·
// Stage · Check (blank) · Remark. Page setup is LANDSCAPE + fit-to-one-
// page-wide so it prints across the page horizontally.
//
// Items arrive pre-sorted (by path, then stage, then code), so we just walk
// them and emit a band wherever the path prefix changes.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { path: string[]; code: string; dims: string; stage: string; color: string; remark: string };

const HEADERS = ["Item", "Dimensions", "Stage", "Check", "Remark"];
const WIDTHS = [46, 20, 16, 10, 28];
// Category bands are HIGHLIGHTED so groups are easy to find at a glance:
// Category 1 is a strong dark band (white text), and each level below it
// steps down to a lighter tint. Indexed by tree depth (0 = Category 1).
const BAND_FILL = ["FF334155", "FFCBD5E1", "FFE2E8F0", "FFEFF3F8", "FFF6F8FB"];
const BAND_TEXT = ["FFFFFFFF", "FF1F2937", "FF1F2937", "FF374151", "FF4B5563"];
const BAND_SIZE = [12.5, 11, 10, 9.5, 9];
const BAND_HEIGHT = [23, 20, 18, 16, 15];

function thinBorder() {
  const s = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
  return { top: s, bottom: s, left: s, right: s };
}
function pick<T>(arr: T[], d: number): T {
  return arr[Math.min(d, arr.length - 1)];
}
function solidArgb(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  return m ? `FF${m[1].toUpperCase()}` : null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { title?: string; items?: Item[] } | null;
  const title = String(body?.title || "Master Excel");
  const items = Array.isArray(body?.items) ? body!.items! : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Master", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: "frozen", ySplit: 2 }],
  });
  // Group bands sit ABOVE their rows, so the +/- collapse control lives on the
  // category heading — collapse a Category 1 band to fold its whole group away.
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1 — small-font title.
  ws.mergeCells(1, 1, 1, HEADERS.length);
  const t = ws.getCell(1, 1);
  t.value = `${title}  ·  ${items.length} slab${items.length === 1 ? "" : "s"}`;
  t.font = { size: 9, italic: true, color: { argb: "FF666666" } };
  t.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 14;

  // Row 2 — header.
  const hr = ws.getRow(2);
  hr.values = HEADERS;
  hr.height = 20;
  hr.eachCell((c) => {
    c.font = { bold: true, size: 9, color: { argb: "FF1F2937" } };
    c.alignment = { vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    c.border = thinBorder();
  });

  let r = 3;
  let prev: string[] = [];
  for (const it of items) {
    // Emit band heading rows for any path segment that differs from prev.
    let common = 0;
    while (common < prev.length && common < it.path.length && prev[common] === it.path[common]) common += 1;
    for (let d = common; d < it.path.length; d += 1) {
      const row = ws.getRow(r);
      row.height = pick(BAND_HEIGHT, d);
      row.outlineLevel = d;
      row.getCell(1).value = it.path[d];
      row.getCell(1).alignment = { vertical: "middle", indent: d };
      row.getCell(1).font = { bold: true, size: pick(BAND_SIZE, d), color: { argb: pick(BAND_TEXT, d) } };
      const fill = pick(BAND_FILL, d);
      const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
      // A heavier rule on top of every Category-1 band separates the groups.
      const top = d === 0 ? { style: "medium" as const, color: { argb: "FF1F2937" } } : thin;
      const border = { top, bottom: thin, left: thin, right: thin };
      for (let col = 1; col <= HEADERS.length; col += 1) {
        const c = row.getCell(col);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        c.border = border;
      }
      r += 1;
    }
    // The slab row, indented one past its deepest band.
    const row = ws.getRow(r);
    row.outlineLevel = it.path.length;
    row.getCell(1).value = it.code;
    row.getCell(1).font = { name: "Consolas", size: 9, bold: true };
    row.getCell(1).alignment = { vertical: "middle", indent: it.path.length };
    row.getCell(2).value = it.dims;
    row.getCell(2).font = { name: "Consolas", size: 9 };
    row.getCell(3).value = it.stage;
    row.getCell(4).value = "";
    row.getCell(5).value = it.remark;
    row.getCell(5).font = { size: 9 };
    const solid = solidArgb(it.color);
    if (solid) {
      const sc = row.getCell(3);
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: solid } };
      sc.font = { size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      sc.alignment = { vertical: "middle", horizontal: "center" };
    }
    for (let col = 1; col <= HEADERS.length; col += 1) row.getCell(col).border = thinBorder();
    r += 1;
    prev = it.path;
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = title.replace(/[^\w]+/g, "-").slice(0, 60) || "master";
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
