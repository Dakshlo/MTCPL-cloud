/**
 * GET /api/salary/pf-export?month=YYYY-MM
 *
 * The PF handler's monthly SALARY & PF REGISTER (mig 191, Daksh Jul 2026) — the
 * exact column layout he asked for:
 *
 *   Sr · Name · Father name · Bank · IFSC · A/c no · Wage for PF · Fixed salary
 *   · Attendance (salary) · Attendance (PF) · OT hours · Days+OT · Salary as per
 *   attendance · PF amount · Salary after PF · Total after OT+PF · Advance ·
 *   Actual salary to be paid · Remarks   (+ a grand-TOTAL row)
 *
 * Rows = the month's salary rows (draft + paid), grouped by designation then
 * name. "Wage for PF" = the ₹15,000-capped PF wage base. Reads ONLY
 * salary_payments + salary_employees.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireAuth } from "@/lib/auth";
import { canUseSalary, PF_WAGE_CEILING } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BORDER = "FFB9A46A";
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD3D3D3" } },
  left: { style: "thin", color: { argb: "FFD3D3D3" } },
  bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
  right: { style: "thin", color: { argb: "FFD3D3D3" } },
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const n2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100;

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    if (!canUseSalary(profile)) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });

    const raw = (req.nextUrl.searchParams.get("month") ?? "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const monthKey = `${m[1]}-${m[2]}-01`;
    const monthTitle = `${MON[Number(m[2]) - 1] ?? m[2]} ${m[1]}`.toUpperCase();

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("salary_payments")
      .select("gross, pf_amount, ot_amount, ot_hours, advance, net, attendance_days, remarks, salary_employees(name, father_name, designation, bank_name, ifsc, account_number, monthly_salary, pf_enabled)")
      .eq("month", monthKey);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type EmpJoin = { name: string; father_name: string | null; designation: string | null; bank_name: string | null; ifsc: string | null; account_number: string | null; monthly_salary: number; pf_enabled: boolean };
    type Row = { gross: number; pf_amount: number; ot_amount: number; ot_hours: number | null; advance: number; net: number; attendance_days: number | null; remarks: string | null; salary_employees: EmpJoin | EmpJoin[] | null };
    const rows = ((data ?? []) as Row[]).map((r) => {
      const e = Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees;
      const gross = Number(r.gross) || 0;
      const pf = Number(r.pf_amount) || 0;
      const ot = Number(r.ot_amount) || 0;
      const advance = Number(r.advance) || 0;
      return {
        name: e?.name ?? "—",
        father: e?.father_name ?? "",
        designation: e?.designation ?? "",
        bank: e?.bank_name ?? "",
        ifsc: e?.ifsc ?? "",
        acc: e?.account_number ?? "",
        wageForPf: e?.pf_enabled ? Math.min(gross, PF_WAGE_CEILING) : 0,
        fixed: Number(e?.monthly_salary) || 0,
        attendance: r.attendance_days == null ? null : Number(r.attendance_days),
        otHours: r.ot_hours == null ? null : Number(r.ot_hours),
        gross, pf, ot, advance,
        afterPf: n2(gross - pf),
        afterOt: n2(gross - pf + ot),
        net: Number(r.net) || 0,
        remarks: r.remarks ?? "",
      };
    }).sort((a, b) => (a.designation || "~").localeCompare(b.designation || "~") || a.name.localeCompare(b.name));

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No salary rows for this month — Prepare the month first." }, { status: 400 });
    }

    const HEADERS = [
      "Sr", "Name", "Father Name", "Bank Name", "IFSC Code", "Bank A/c No.",
      "Wage for PF", "Fixed Salary", "Attend. (Salary)", "Attend. (PF)", "OT Hours", "Days + OT",
      "Salary as per Attendance", "PF Amount", "Salary after PF", "Total after OT + PF",
      "Advance", "Actual Salary to be Paid", "Remarks",
    ];
    const MONEY = "#,##0.00";
    const WIDTHS = [4, 22, 22, 20, 13, 18, 11, 12, 11, 11, 8, 9, 14, 11, 13, 14, 11, 15, 26];

    const wb = new ExcelJS.Workbook();
    wb.creator = "MTCPL Cloud";
    const ws = wb.addWorksheet("Salary & PF");
    ws.columns = WIDTHS.map((w) => ({ width: w }));

    // Title band.
    const last = ws.getColumn(HEADERS.length).letter;
    ws.mergeCells(`A1:${last}1`);
    const t = ws.getCell("A1");
    t.value = `MATESHWARI TEMPLE CONSTRUCTION PVT. LTD. — SALARY & PF REGISTER (${monthTitle})`;
    t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    t.fill = fill("FF9C5F6E");
    t.alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 26;

    // Header row.
    const hr = ws.getRow(2);
    HEADERS.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 9.5, color: { argb: "FFFFFFFF" } };
      c.fill = fill("FF6b4652");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = { ...thin, bottom: { style: "medium", color: { argb: BORDER } } };
    });
    hr.height = 34;

    // Data rows.
    let sr = 0;
    for (const r of rows) {
      sr += 1;
      const daysPlusOt = (r.attendance ?? 0) + (r.otHours ?? 0);
      const cells: (string | number)[] = [
        sr, r.name, r.father, r.bank, r.ifsc, r.acc,
        r.wageForPf, r.fixed,
        r.attendance ?? "", r.attendance ?? "", r.otHours ?? "", daysPlusOt || "",
        r.gross, r.pf, r.afterPf, r.afterOt, r.advance, r.net, r.remarks,
      ];
      const row = ws.addRow(cells);
      row.eachCell((c, col) => {
        c.border = thin;
        c.font = { size: 9.5 };
        c.alignment = { vertical: "middle", horizontal: col <= 6 || col === 19 ? "left" : "right", wrapText: col === 19 };
        if (col >= 7 && col <= 18 && typeof c.value === "number") c.numFmt = MONEY;
      });
      if (sr % 2 === 0) row.eachCell((c) => { c.fill = fill("FFF6EFF1"); });
    }

    // TOTAL row.
    const sum = (f: (r: (typeof rows)[number]) => number) => n2(rows.reduce((a, r) => a + f(r), 0));
    const totalRow = ws.addRow([
      "", "TOTAL", "", "", "", "",
      sum((r) => r.wageForPf), sum((r) => r.fixed), "", "", "", "",
      sum((r) => r.gross), sum((r) => r.pf), sum((r) => r.afterPf), sum((r) => r.afterOt),
      sum((r) => r.advance), sum((r) => r.net), "",
    ]);
    totalRow.eachCell((c, col) => {
      c.font = { bold: true, size: 10 };
      c.fill = fill("FFEDE3E6");
      c.border = { ...thin, top: { style: "double", color: { argb: BORDER } } };
      c.alignment = { vertical: "middle", horizontal: col <= 6 ? "left" : "right" };
      if (col >= 7 && col <= 18 && typeof c.value === "number") c.numFmt = MONEY;
    });

    ws.views = [{ state: "frozen", ySplit: 2 }];

    const buf = await wb.xlsx.writeBuffer();
    void logAudit(profile.id, "salary_pf_register_exported", "salary_month", monthKey, { rows: rows.length });
    return new Response(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="salary-pf-register-${m[1]}-${m[2]}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
