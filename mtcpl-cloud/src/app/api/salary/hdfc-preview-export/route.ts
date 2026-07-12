/**
 * GET /api/salary/hdfc-preview-export?month=YYYY-MM&batch=<batch-id>
 *
 * Employees dept — a READABLE Excel of a batch's payment rows, so the team can
 * verify what the HDFC bank CSV will contain (names, bank details, amounts) and
 * the deduction breakdown BEFORE (or after) downloading the real .001 file.
 *
 * Unlike the CSV route this is a VIEW copy: NO atomic lock, downloadable any
 * number of times, and it shows every row of the batch (draft AND paid) so it
 * stays useful after the batch is paid. Never blocks.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD8DEE9" } }, left: { style: "thin", color: { argb: "FFD8DEE9" } },
  bottom: { style: "thin", color: { argb: "FFD8DEE9" } }, right: { style: "thin", color: { argb: "FFD8DEE9" } },
};

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    if (!canUseSalary(profile)) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });

    const raw = (req.nextUrl.searchParams.get("month") ?? "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const month = `${m[1]}-${m[2]}-01`;
    const mm = `${m[1]}-${m[2]}`;
    const batchId = (req.nextUrl.searchParams.get("batch") ?? "").trim() || null;

    const admin = createAdminSupabaseClient();
    let q = admin
      .from("salary_payments")
      .select("gross, pf_amount, esi_amount, tds_amount, ot_amount, advance, other_deduction, addition, net, attendance_days, status, salary_employees(name, organization, designation, beneficiary_name, account_number, bank_name, ifsc, salary_type)");
    q = batchId ? q.eq("batch_id", batchId) : q.eq("month", month).is("batch_id", null);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Emp = { name: string; organization: string | null; designation: string | null; beneficiary_name: string | null; account_number: string | null; bank_name: string | null; ifsc: string | null; salary_type: string | null };
    type Row = { gross: number; pf_amount: number; esi_amount: number; tds_amount: number; ot_amount: number; advance: number; other_deduction: number; addition: number; net: number; attendance_days: number | null; status: string; salary_employees: Emp | Emp[] | null };
    const rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = (Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees) ?? ({} as Emp);
      return {
        name: e.name ?? "—", designation: (e.designation ?? "").trim(),
        beneficiary: (e.beneficiary_name ?? e.name ?? "").trim().toUpperCase(),
        bank: (e.bank_name ?? "").trim(), account: (e.account_number ?? "").trim(), ifsc: (e.ifsc ?? "").trim().toUpperCase(),
        variable: (e.salary_type ?? "fixed") === "variable", attendance: r.attendance_days, status: r.status,
        gross: Number(r.gross) || 0, ot: Number(r.ot_amount) || 0, pf: Number(r.pf_amount) || 0, esi: Number(r.esi_amount) || 0,
        tds: Number(r.tds_amount) || 0, advance: Number(r.advance) || 0, ded: Number(r.other_deduction) || 0, add: Number(r.addition) || 0,
        net: Number(r.net) || 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const wb = new ExcelJS.Workbook();
    wb.creator = "MTCPL Cloud";
    const ws = wb.addWorksheet("Bank file preview", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const HEADS = ["#", "Employee", "Designation", "Beneficiary (bank)", "Bank", "A/c number", "IFSC", "Attend.", "Earned", "OT", "PF", "ESI", "TDS", "Advance", "Deduction", "Addition", "NET PAY"];
    const WIDTHS = [4, 24, 16, 22, 16, 20, 13, 8, 12, 10, 10, 10, 10, 11, 11, 11, 13];
    ws.columns = WIDTHS.map((w) => ({ width: w }));

    const last = ws.getColumn(HEADS.length).letter;
    ws.mergeCells(`A1:${last}1`);
    const title = ws.getCell("A1");
    title.value = `Bank-file preview · ${mm}  —  verify names, bank details & amounts before the HDFC CSV`;
    title.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    title.fill = fill("FF1F6F4B");
    title.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 22;

    const hr = ws.getRow(2);
    HEADS.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h; c.font = { bold: true, size: 9.5, color: { argb: "FFFFFFFF" } };
      c.fill = fill("FF334155"); c.alignment = { horizontal: i >= 8 ? "right" : "left", vertical: "middle", wrapText: true };
      c.border = thin;
    });
    ws.getRow(2).height = 26;

    const MONEY = "#,##0";
    const tot = { gross: 0, ot: 0, pf: 0, esi: 0, tds: 0, advance: 0, ded: 0, add: 0, net: 0 };
    rows.forEach((r, i) => {
      const vals = [i + 1, r.name, r.designation || "—", r.beneficiary || "—", r.bank || "—", r.account || "⚠ missing", r.ifsc || "⚠ missing",
        r.variable ? (r.attendance ?? "⚠") : "—", r.gross, r.ot, r.pf, r.esi, r.tds, r.advance, r.ded, r.add, r.net];
      const row = ws.addRow(vals);
      const bad = !r.account || !r.ifsc || !r.beneficiary || !(r.net > 0);
      row.eachCell((c, col) => {
        c.border = thin;
        c.font = { size: 9.5, color: { argb: bad ? "FFB91C1C" : "FF1E293B" } };
        c.fill = fill(i % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF");
        c.alignment = { vertical: "middle", horizontal: col >= 9 ? "right" : col === 8 ? "center" : "left" };
        if (col >= 9 && typeof c.value === "number") c.numFmt = MONEY;
      });
      tot.gross += r.gross; tot.ot += r.ot; tot.pf += r.pf; tot.esi += r.esi; tot.tds += r.tds; tot.advance += r.advance; tot.ded += r.ded; tot.add += r.add; tot.net += r.net;
    });

    const totalRow = ws.addRow(["", `TOTAL · ${rows.length} employee${rows.length === 1 ? "" : "s"}`, "", "", "", "", "", "", tot.gross, tot.ot, tot.pf, tot.esi, tot.tds, tot.advance, tot.ded, tot.add, tot.net]);
    totalRow.eachCell((c, col) => {
      c.font = { bold: true, size: 10, color: { argb: "FF0F172A" } };
      c.fill = fill("FFE2E8F0"); c.border = { ...thin, top: { style: "double", color: { argb: "FF334155" } } };
      c.alignment = { vertical: "middle", horizontal: col >= 9 ? "right" : "left" };
      if (col >= 9 && typeof c.value === "number") c.numFmt = MONEY;
    });

    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];

    const buf = await wb.xlsx.writeBuffer();
    return new Response(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="salary-bankfile-preview-${mm}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
