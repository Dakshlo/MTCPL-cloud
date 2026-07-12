/**
 * GET /api/salary/wage-register-export?month=YYYY-MM[&organizations=CSV | &designations=CSV]
 *
 * The statutory "Register of Wages" — Form No. 11, Rule 27(1) — for the month's
 * PAID employees (Daksh, Jul 2026). Landscape, cream "register paper" colours to
 * match the physical book. Data computed by loadWageRegister so the Excel and
 * the in-app preview page (/salary/register) never disagree.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { loadWageRegister } from "@/app/(app)/salary/_data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF9C7A86" } }, left: { style: "thin", color: { argb: "FF9C7A86" } },
  bottom: { style: "thin", color: { argb: "FF9C7A86" } }, right: { style: "thin", color: { argb: "FF9C7A86" } },
};
// Cream "register paper" palette.
const PAPER = "FFFBF7E2";      // page cream
const PAPER_ALT = "FFF6F0D2";  // zebra
const MAROON = "FF9C5F6E";     // title band
const MAROON_DK = "FF6B4652";  // header band
const dmy = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${String(ist.getUTCDate()).padStart(2, "0")}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${ist.getUTCFullYear()}`;
};

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    if (!canUseSalary(profile)) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });

    const raw = (req.nextUrl.searchParams.get("month") ?? "").trim();
    if (!/^\d{4}-\d{2}/.test(raw)) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const orgParam = (req.nextUrl.searchParams.get("organizations") ?? "").trim();
    const desigParam = (req.nextUrl.searchParams.get("designations") ?? "").trim();

    const admin = createAdminSupabaseClient();
    const reg = await loadWageRegister(admin, raw.slice(0, 7), {
      organizations: orgParam ? orgParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
      designations: desigParam ? desigParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
    });
    if (!reg.ok) return NextResponse.json({ ok: false, error: reg.error }, { status: 400 });
    if (reg.rows.length === 0) return NextResponse.json({ ok: false, error: "No PAID employees match this month / selection — mark a batch paid first." }, { status: 400 });
    const { rows, totals, year, mon, monthName, periodStr, scope } = reg;
    const mm = String(mon).padStart(2, "0");

    const wb = new ExcelJS.Workbook();
    wb.creator = "MTCPL Cloud";
    const ws = wb.addWorksheet("Register of Wages", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    const WIDTHS = [6, 28, 15, 14, 15, 9, 13, 12, 14, 11, 11, 11, 12, 15, 14, 18];
    ws.columns = WIDTHS.map((w) => ({ width: w }));
    const LAST = ws.getColumn(WIDTHS.length).letter;

    const title = (r: number, text: string, size: number, argb: string) => {
      ws.mergeCells(`A${r}:${LAST}${r}`);
      const c = ws.getCell(`A${r}`);
      c.value = text; c.font = { bold: true, size, color: { argb: "FFFFFFFF" } }; c.fill = fill(argb);
      c.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(r).height = size + 12;
    };
    title(1, "MATESHWARI TEMPLE CONSTRUCTION PVT. LTD.", 14, MAROON);
    title(2, "REGISTER OF WAGES — Form No. 11, Rule 27(1)", 11, MAROON_DK);
    ws.mergeCells(`A3:${LAST}3`);
    const sub = ws.getCell("A3");
    sub.value = `Wages Period: ${periodStr}${scope ? ` · ${scope}` : ""}`;
    sub.font = { bold: true, size: 10.5, color: { argb: "FF5C3A44" } };
    sub.fill = fill(PAPER_ALT);
    sub.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(3).height = 18;

    const H1 = ["Sl. No.\nक्र.सं.", "Name of worker\nकर्मचारी का नाम", "Wages Period\nवेतन अवधि", "Min. Rate of Wages (A)\nन्यूनतम वेतन दर", "Actual Rate of Wages Paid (B)\nवास्तविक वेतन दर", "Days Worked\nकार्य दिवस", "Actual Wages\nवास्तविक वेतन", "Any other Allowance\nअन्य भत्ते", "Gross Wages (6+7)\nकुल वेतन", "Kind of Deduction — कटौती की विवरण", "", "", "", "Actual Net Wages Paid\nवास्तविक शुद्ध वेतन", "Date of Payment\nभुगतान तिथि", "Signature / thumb\nहस्ताक्षर / अंगूठा"];
    const hr = ws.getRow(4);
    H1.forEach((h, i) => { hr.getCell(i + 1).value = h; });
    ws.mergeCells(4, 10, 4, 13);
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16].forEach((col) => ws.mergeCells(4, col, 5, col));
    const sr5 = ws.getRow(5);
    ["E.S.I.", "P.F.", "TDS", "Total"].forEach((h, i) => { sr5.getCell(10 + i).value = h; });
    for (let col = 1; col <= 16; col++) for (const rr of [4, 5]) {
      const c = ws.getRow(rr).getCell(col);
      c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      c.fill = fill(MAROON_DK);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = thin;
    }
    ws.getRow(4).height = 40;
    const numRow = ws.getRow(6);
    ["1", "2", "3", "3(अ)", "4", "5(ब)", "6", "7", "8", "9", "9", "9", "9", "10", "11", "12"].forEach((n, i) => {
      const c = numRow.getCell(i + 1); c.value = n; c.font = { size: 8.5, italic: true, color: { argb: "FF6B7280" } };
      c.fill = fill(PAPER_ALT); c.alignment = { horizontal: "center" }; c.border = thin;
    });

    const MONEY = "#,##0";
    for (const r of rows) {
      const cells: (string | number)[] = [
        r.sr,
        r.father ? `${r.name}\ns/o ${r.father}` : r.name,
        `${monthName} ${year}`,
        r.minWage > 0 ? r.minWage.toLocaleString("en-IN") : "—",
        r.rate > 0 ? `${r.rate.toLocaleString("en-IN")} / ${r.variable ? "day" : "month"}` : "—",
        r.attendance != null ? r.attendance : "—",
        r.basic,
        r.allow > 0 ? r.allow : "—",
        r.gross,
        r.esi > 0 ? r.esi : "—",
        r.pf > 0 ? r.pf : "—",
        r.tds > 0 ? r.tds : "—",
        r.ded > 0 ? r.ded : "—",
        r.net,
        dmy(r.paidAt),
        "",
      ];
      const row = ws.addRow(cells);
      row.height = r.father ? 30 : 20;
      const bg = r.sr % 2 === 0 ? PAPER_ALT : PAPER;
      row.eachCell((c, col) => {
        c.border = thin;
        c.font = { size: 9.5, color: { argb: "FF2A1720" } };
        c.fill = fill(bg);
        c.alignment = { vertical: "middle", horizontal: col === 2 ? "left" : col >= 7 && col <= 14 ? "right" : "center", wrapText: col === 2 };
        if (col >= 7 && col <= 14 && typeof c.value === "number") c.numFmt = MONEY;
      });
    }

    const totalRow = ws.addRow(["", "TOTAL", "", "", "", "", totals.basic, totals.allow, totals.gross, totals.esi, totals.pf, totals.tds, totals.ded, totals.net, "", ""]);
    totalRow.eachCell((c, col) => {
      c.font = { bold: true, size: 10, color: { argb: "FF2A1720" } };
      c.fill = fill("FFEAD9B0");
      c.border = { ...thin, top: { style: "double", color: { argb: MAROON } } };
      c.alignment = { vertical: "middle", horizontal: col === 2 ? "left" : "right" };
      if (col >= 7 && col <= 14 && typeof c.value === "number") c.numFmt = MONEY;
    });

    // Cream "paper" fill for a few blank rows so it reads like the register book.
    for (let i = 0; i < 8; i++) {
      const r = ws.addRow([]);
      for (let col = 1; col <= 16; col++) r.getCell(col).fill = fill(PAPER);
    }

    const noteRow = ws.addRow([]);
    ws.mergeCells(noteRow.number, 1, noteRow.number, 13);
    const note = ws.getCell(noteRow.number, 1);
    note.value = "(अ) न्यूनतम वेतन अधिनियम 1948 के अधीन निर्धारित वेतन दर।   (ब) यदि कार्य दिन संख्या तथा वेतन की गई भिन्न-भिन्न हो तो बाद वाली दिन संख्या कारण 6 में दर्शाया जावे।";
    note.font = { size: 8, italic: true, color: { argb: "FF6B7280" } }; note.fill = fill(PAPER);
    note.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(noteRow.number, 14, noteRow.number, 16);
    const sig = ws.getCell(noteRow.number, 14);
    sig.value = "Signature of the employer\nor person authorised by him";
    sig.font = { size: 9, bold: true, color: { argb: "FF2A1720" } }; sig.fill = fill(PAPER);
    sig.alignment = { horizontal: "center", vertical: "bottom", wrapText: true };
    ws.getRow(noteRow.number).height = 46;

    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6 }];

    const buf = await wb.xlsx.writeBuffer();
    void logAudit(profile.id, "salary_wage_register_exported", "salary_month", `${year}-${mm}-01`, { rows: rows.length, scope });
    return new Response(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="wage-register-${year}-${mm}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
