/**
 * GET /api/salary/wage-register-export?month=YYYY-MM[&organizations=CSV | &designations=CSV]
 *
 * The statutory "Register of Wages" — Form No. 11, Rule 27(1) — for the month's
 * PAID employees (Daksh, Jul 2026). Reproduces the physical register: Sl.No,
 * name (s/o father), wages period, actual rate, days worked, wages + allowances,
 * gross, the deduction block (ESI · PF · TDS · Total) and the net wages paid,
 * with a date + signature column left blank for the register.
 *
 * Scope: everyone paid this month, or a chosen set of organizations OR
 * designations. Reads ONLY salary_payments + salary_employees.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_ORG = "(No organization)";
const NO_DESIG = "(No designation)";
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF9AA0A6" } }, left: { style: "thin", color: { argb: "FF9AA0A6" } },
  bottom: { style: "thin", color: { argb: "FF9AA0A6" } }, right: { style: "thin", color: { argb: "FF9AA0A6" } },
};
const n2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100;
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
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const year = Number(m[1]), mon = Number(m[2]);
    const monthKey = `${m[1]}-${m[2]}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const periodStr = `01-${m[2]}-${m[1]} to ${String(lastDay).padStart(2, "0")}-${m[2]}-${m[1]}`;

    const orgParam = (req.nextUrl.searchParams.get("organizations") ?? "").trim();
    const desigParam = (req.nextUrl.searchParams.get("designations") ?? "").trim();
    const wantOrgs = orgParam ? new Set(orgParam.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    const wantDesigs = desigParam ? new Set(desigParam.split(",").map((s) => s.trim()).filter(Boolean)) : null;

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("salary_payments")
      // salary_employees(*) — resilient if a newer column is missing.
      .select("gross, pf_amount, esi_amount, tds_amount, ot_amount, addition, net, attendance_days, paid_at, salary_employees(*)")
      .eq("month", monthKey)
      .eq("status", "paid");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Emp = Record<string, unknown>;
    type Row = { gross: number; pf_amount: number; esi_amount: number; tds_amount: number; ot_amount: number; addition: number; net: number; attendance_days: number | null; paid_at: string | null; salary_employees: Emp | Emp[] | null };
    let rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = (Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees) ?? {};
      const org = ((e.organization as string | null) ?? "").trim();
      const desig = ((e.designation as string | null) ?? "").trim();
      const variable = (e.salary_type as string) === "variable";
      return {
        name: String(e.name ?? "—"),
        father: (e.father_name as string | null) ?? "",
        org, desig,
        variable,
        rate: variable ? Number(e.daily_salary) || 0 : Number(e.monthly_salary) || 0,
        attendance: r.attendance_days,
        basic: Number(r.gross) || 0,
        allow: (Number(r.ot_amount) || 0) + (Number(r.addition) || 0),
        pf: Number(r.pf_amount) || 0,
        esi: Number(r.esi_amount) || 0,
        tds: Number(r.tds_amount) || 0,
        paidAt: r.paid_at,
      };
    });

    if (wantOrgs) rows = rows.filter((r) => wantOrgs.has(r.org || NO_ORG));
    if (wantDesigs) rows = rows.filter((r) => wantDesigs.has(r.desig || NO_DESIG));
    rows.sort((a, b) => (a.org || "~").localeCompare(b.org || "~") || (a.desig || "~").localeCompare(b.desig || "~") || a.name.localeCompare(b.name));

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No PAID employees match this month / selection — mark a batch paid first." }, { status: 400 });
    }

    // ── Build the register ────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "MTCPL Cloud";
    const ws = wb.addWorksheet("Register of Wages");
    // 16 columns: Sl · Name · Period · MinRate · ActRate · Days · Wages ·
    // Allowance · Gross · ESI · PF · TDS · TotalDed · Net · Date · Signature.
    const WIDTHS = [6, 28, 15, 14, 15, 9, 13, 12, 14, 11, 11, 11, 12, 15, 14, 18];
    ws.columns = WIDTHS.map((w) => ({ width: w }));
    const LAST = ws.getColumn(WIDTHS.length).letter;

    // Title band.
    const title = (r: number, text: string, size: number, argb: string, fg = "FFFFFFFF") => {
      ws.mergeCells(`A${r}:${LAST}${r}`);
      const c = ws.getCell(`A${r}`);
      c.value = text; c.font = { bold: true, size, color: { argb: fg } }; c.fill = fill(argb);
      c.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(r).height = size + 12;
    };
    title(1, "MATESHWARI TEMPLE CONSTRUCTION PVT. LTD.", 14, "FF9C5F6E");
    title(2, "REGISTER OF WAGES — Form No. 11, Rule 27(1)", 11, "FF6b4652");
    ws.mergeCells(`A3:${LAST}3`);
    const sub = ws.getCell("A3");
    sub.value = `Wages Period: ${periodStr}${wantOrgs ? ` · Organization: ${[...wantOrgs].join(", ")}` : ""}${wantDesigs ? ` · Designation: ${[...wantDesigs].join(", ")}` : ""}`;
    sub.font = { bold: true, size: 10.5, color: { argb: "FF3B4A5A" } };
    sub.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(3).height = 18;

    // Header rows (4 = group headers, 5 = sub-headers, 6 = column numbers).
    const H1 = ["Sl. No.\nक्र.सं.", "Name of worker\nकर्मचारी का नाम", "Wages Period\nवेतन अवधि", "Min. Rate of Wages (A)\nन्यूनतम वेतन दर", "Actual Rate of Wages Paid (B)\nवास्तविक वेतन दर", "Days Worked\nकार्य दिवस", "Actual Wages\nवास्तविक वेतन", "Any other Allowance\nअन्य भत्ते", "Gross Wages (6+7)\nकुल वेतन", "Kind of Deduction — कटौती की विवरण", "", "", "", "Actual Net Wages Paid\nवास्तविक शुद्ध वेतन", "Date of Payment\nभुगतान तिथि", "Signature / thumb\nहस्ताक्षर / अंगूठा"];
    const hr = ws.getRow(4);
    H1.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; });
    // Merge the deduction group header across cols 10–13.
    ws.mergeCells(4, 10, 4, 13);
    // Merge every non-deduction header cell down over rows 4–5.
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16].forEach((col) => ws.mergeCells(4, col, 5, col));
    const sr5 = ws.getRow(5);
    ["E.S.I.", "P.F.", "TDS", "Total"].forEach((h, i) => { sr5.getCell(10 + i).value = h; });
    for (let col = 1; col <= 16; col++) {
      for (const rr of [4, 5]) {
        const c = ws.getRow(rr).getCell(col);
        c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        c.fill = fill("FF6b4652");
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = thin;
      }
    }
    ws.getRow(4).height = 40;
    // Column-number row.
    const numRow = ws.getRow(6);
    ["1", "2", "3", "3(अ)", "4", "5(ब)", "6", "7", "8", "9", "9", "9", "9", "10", "11", "12"].forEach((n, i) => {
      const c = numRow.getCell(i + 1); c.value = n; c.font = { size: 8.5, italic: true, color: { argb: "FF6B7280" } };
      c.alignment = { horizontal: "center" }; c.border = thin;
    });

    // Data rows.
    const MONEY = "#,##0";
    let sr = 0;
    const tot = { basic: 0, allow: 0, gross: 0, esi: 0, pf: 0, tds: 0, ded: 0, net: 0 };
    for (const r of rows) {
      sr += 1;
      const gross = n2(r.basic + r.allow);
      const ded = n2(r.esi + r.pf + r.tds);
      const net = n2(gross - ded);
      tot.basic += r.basic; tot.allow += r.allow; tot.gross += gross; tot.esi += r.esi; tot.pf += r.pf; tot.tds += r.tds; tot.ded += ded; tot.net += net;
      const cells: (string | number)[] = [
        sr,
        r.father ? `${r.name}\ns/o ${r.father}` : r.name,
        `${MON[mon - 1]} ${year}`,
        "—",
        r.rate > 0 ? `${r.rate.toLocaleString("en-IN")} / ${r.variable ? "day" : "month"}` : "—",
        r.attendance != null ? r.attendance : "—",
        n2(r.basic),
        r.allow > 0 ? n2(r.allow) : "—",
        gross,
        r.esi > 0 ? n2(r.esi) : "—",
        r.pf > 0 ? n2(r.pf) : "—",
        r.tds > 0 ? n2(r.tds) : "—",
        ded > 0 ? ded : "—",
        net,
        dmy(r.paidAt),
        "",
      ];
      const row = ws.addRow(cells);
      row.height = r.father ? 30 : 20;
      row.eachCell((c, col) => {
        c.border = thin;
        c.font = { size: 9.5 };
        c.alignment = { vertical: "middle", horizontal: col === 2 ? "left" : col >= 7 && col <= 14 ? "right" : "center", wrapText: col === 2 };
        if (col >= 7 && col <= 14 && typeof c.value === "number") c.numFmt = MONEY;
      });
    }

    // TOTAL row.
    const totalRow = ws.addRow(["", "TOTAL", "", "", "", "", n2(tot.basic), n2(tot.allow), n2(tot.gross), n2(tot.esi), n2(tot.pf), n2(tot.tds), n2(tot.ded), n2(tot.net), "", ""]);
    totalRow.eachCell((c, col) => {
      c.font = { bold: true, size: 10 };
      c.fill = fill("FFEDE3E6");
      c.border = { ...thin, top: { style: "double", color: { argb: "FF9C5F6E" } } };
      c.alignment = { vertical: "middle", horizontal: col === 2 ? "left" : "right" };
      if (col >= 7 && col <= 14 && typeof c.value === "number") c.numFmt = MONEY;
    });

    // Footer notes + employer signature.
    const noteRow = ws.addRow([]);
    ws.mergeCells(noteRow.number, 1, noteRow.number, 13);
    const note = ws.getCell(noteRow.number, 1);
    note.value = "(अ) न्यूनतम वेतन अधिनियम 1948 के अधीन निर्धारित वेतन दर।   (ब) यदि कार्य दिन संख्या तथा वेतन की गई भिन्न-भिन्न हो तो बाद वाली दिन संख्या कारण 6 में दर्शाया जावे।";
    note.font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
    note.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(noteRow.number, 14, noteRow.number, 16);
    const sig = ws.getCell(noteRow.number, 14);
    sig.value = "Signature of the employer\nor person authorised by him";
    sig.font = { size: 9, bold: true };
    sig.alignment = { horizontal: "center", vertical: "bottom", wrapText: true };
    ws.getRow(noteRow.number).height = 46;

    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6 }];

    const buf = await wb.xlsx.writeBuffer();
    void logAudit(profile.id, "salary_wage_register_exported", "salary_month", monthKey, { rows: rows.length, orgs: wantOrgs ? [...wantOrgs] : null, designations: wantDesigs ? [...wantDesigs] : null });
    return new Response(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="wage-register-${m[1]}-${m[2]}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
