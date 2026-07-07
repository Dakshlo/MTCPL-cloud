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
import { designationColor } from "@/lib/salary-designation-color";
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
      // salary_employees(*) — pull every employee column so this stays resilient
      // if the organization column (mig 192) hasn't been added yet.
      .select("gross, pf_amount, ot_amount, ot_hours, advance, net, attendance_days, remarks, salary_employees(*)")
      .eq("month", monthKey);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type EmpJoin = { name: string; father_name: string | null; organization: string | null; designation: string | null; bank_name: string | null; ifsc: string | null; account_number: string | null; monthly_salary: number; pf_enabled: boolean };
    type Row = { gross: number; pf_amount: number; ot_amount: number; ot_hours: number | null; advance: number; net: number; attendance_days: number | null; remarks: string | null; salary_employees: EmpJoin | EmpJoin[] | null };
    // Blank organizations / designations sort + group under these labels everywhere.
    const NO_ORG = "(No organization)";
    const NO_DESIG = "(No designation)";
    let rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees;
      const gross = Number(r.gross) || 0;
      const pf = Number(r.pf_amount) || 0;
      const ot = Number(r.ot_amount) || 0;
      const advance = Number(r.advance) || 0;
      return {
        name: e?.name ?? "—",
        father: e?.father_name ?? "",
        organization: (e?.organization ?? "").trim() || NO_ORG,
        designation: (e?.designation ?? "").trim() || NO_DESIG,
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
    }).sort((a, b) =>
      (a.organization === NO_ORG ? 1 : 0) - (b.organization === NO_ORG ? 1 : 0) ||
      a.organization.localeCompare(b.organization) ||
      (a.designation === NO_DESIG ? 1 : 0) - (b.designation === NO_DESIG ? 1 : 0) ||
      a.designation.localeCompare(b.designation) ||
      a.name.localeCompare(b.name),
    );

    // Optional designation filter (?designations=CSV). Absent → export everyone;
    // present → only the chosen designations (so the handler can pull one shed /
    // one department at a time).
    const desigParam = (req.nextUrl.searchParams.get("designations") ?? "").trim();
    if (desigParam) {
      const want = new Set(desigParam.split(",").map((s) => s.trim()).filter(Boolean));
      rows = rows.filter((r) => want.has(r.designation));
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: desigParam ? "No rows for the chosen designations this month." : "No salary rows for this month — Prepare the month first." }, { status: 400 });
    }

    // Two leftmost grouping columns — Organization (col 1) then Designation
    // (col 2) — are each merged + rotated per group, like the PF handler's own
    // sheet. Everything else follows.
    const HEADERS = [
      "Organization", "Designation",
      "Sr", "Name", "Father Name", "Bank Name", "IFSC Code", "Bank A/c No.",
      "Wage for PF", "Fixed Salary", "Attend. (Salary)", "Attend. (PF)", "OT Hours", "Days + OT",
      "Salary as per Attendance", "PF Amount", "Salary after PF", "Total after OT + PF",
      "Advance", "Actual Salary to be Paid", "Remarks",
    ];
    const MONEY = "#,##0.00";
    const WIDTHS = [7, 7, 4, 22, 22, 20, 13, 18, 11, 12, 11, 11, 8, 9, 14, 11, 13, 14, 11, 15, 26];
    // Money columns after the +2 organization/designation shift (Wage for PF … Actual Salary).
    const MONEY_FROM = 9, MONEY_TO = 20;

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

    // Data rows — track contiguous organization AND designation groups (rows are
    // pre-sorted org → designation) so we can merge + rotate the two leftmost
    // columns per group. A designation group also breaks on an org change, so the
    // same designation under two sites stays as two separate merged blocks.
    const orgGroups: Array<{ org: string; start: number; end: number }> = [];
    const desigGroups: Array<{ org: string; desig: string; start: number; end: number }> = [];
    let sr = 0;
    for (const r of rows) {
      sr += 1;
      const daysPlusOt = (r.attendance ?? 0) + (r.otHours ?? 0);
      const cells: (string | number)[] = [
        "", // organization — filled by the org merge below
        "", // designation — filled by the group merge below
        sr, r.name, r.father, r.bank, r.ifsc, r.acc,
        r.wageForPf, r.fixed,
        r.attendance ?? "", r.attendance ?? "", r.otHours ?? "", daysPlusOt || "",
        r.gross, r.pf, r.afterPf, r.afterOt, r.advance, r.net, r.remarks,
      ];
      const row = ws.addRow(cells);
      row.eachCell((c, col) => {
        c.border = thin;
        c.font = { size: 9.5 };
        c.alignment = { vertical: "middle", horizontal: col <= 8 || col === 21 ? "left" : "right", wrapText: col === 21 };
        if (col >= MONEY_FROM && col <= MONEY_TO && typeof c.value === "number") c.numFmt = MONEY;
      });
      if (sr % 2 === 0) row.eachCell((c) => { c.fill = fill("FFF6EFF1"); });
      const og = orgGroups[orgGroups.length - 1];
      if (og && og.org === r.organization) og.end = row.number;
      else orgGroups.push({ org: r.organization, start: row.number, end: row.number });
      const dg = desigGroups[desigGroups.length - 1];
      if (dg && dg.org === r.organization && dg.desig === r.designation) dg.end = row.number;
      else desigGroups.push({ org: r.organization, desig: r.designation, start: row.number, end: row.number });
    }

    // Merge + rotate the two leftmost grouping columns — Organization (col 1)
    // and Designation (col 2) — each in its own stable colour (matched to the
    // on-screen grouping + the subtotal tables).
    for (const g of orgGroups) {
      if (g.end > g.start) ws.mergeCells(g.start, 1, g.end, 1);
      const oc = designationColor(g.org);
      const c = ws.getCell(g.start, 1);
      c.value = g.org;
      c.alignment = { textRotation: 90, vertical: "middle", horizontal: "center", wrapText: true };
      c.font = { bold: true, size: 9.5, color: { argb: oc.fgArgb } };
      c.fill = fill(oc.bgArgb);
      c.border = thin;
    }
    for (const g of desigGroups) {
      if (g.end > g.start) ws.mergeCells(g.start, 2, g.end, 2);
      const dc = designationColor(g.desig);
      const c = ws.getCell(g.start, 2);
      c.value = g.desig;
      c.alignment = { textRotation: 90, vertical: "middle", horizontal: "center", wrapText: true };
      c.font = { bold: true, size: 9.5, color: { argb: dc.fgArgb } };
      c.fill = fill(dc.bgArgb);
      c.border = thin;
    }

    // TOTAL row.
    const sum = (f: (r: (typeof rows)[number]) => number) => n2(rows.reduce((a, r) => a + f(r), 0));
    const totalRow = ws.addRow([
      "", "", "", "TOTAL", "", "", "", "",
      sum((r) => r.wageForPf), sum((r) => r.fixed), "", "", "", "",
      sum((r) => r.gross), sum((r) => r.pf), sum((r) => r.afterPf), sum((r) => r.afterOt),
      sum((r) => r.advance), sum((r) => r.net), "",
    ]);
    totalRow.eachCell((c, col) => {
      c.font = { bold: true, size: 10 };
      c.fill = fill("FFEDE3E6");
      c.border = { ...thin, top: { style: "double", color: { argb: BORDER } } };
      c.alignment = { vertical: "middle", horizontal: col <= 8 ? "left" : "right" };
      if (col >= MONEY_FROM && col <= MONEY_TO && typeof c.value === "number") c.numFmt = MONEY;
    });

    // A colourful "<caption>" mini-table: one coloured row per key (headcount +
    // Actual-Salary-to-be-Paid total) then a grand total. The key cell wears its
    // own stable colour (same palette as the on-screen grouping + rotated cols);
    // the number cells stay plain so the amounts read cleanly.
    const addSubtotalTable = (caption: string, keyHeader: string, by: Map<string, { count: number; net: number }>) => {
      ws.addRow([]); // spacer
      const capRow = ws.addRow([caption]);
      ws.mergeCells(capRow.number, 1, capRow.number, 3);
      const cap = ws.getCell(capRow.number, 1);
      cap.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cap.fill = fill("FF9C5F6E");
      cap.alignment = { vertical: "middle", horizontal: "left" };
      const subHdr = ws.addRow([keyHeader, "Employees", "Amount"]);
      subHdr.eachCell((c, col) => {
        if (col > 3) return;
        c.font = { bold: true, size: 9.5, color: { argb: "FFFFFFFF" } };
        c.fill = fill("FF6b4652");
        c.alignment = { horizontal: col === 1 ? "left" : "right", vertical: "middle" };
        c.border = thin;
      });
      for (const [key, v] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const kc = designationColor(key);
        const rr = ws.addRow([key, v.count, n2(v.net)]);
        rr.eachCell((c, col) => {
          if (col > 3) return;
          if (col === 1) { c.font = { size: 9.5, bold: true, color: { argb: kc.fgArgb } }; c.fill = fill(kc.bgArgb); }
          else c.font = { size: 9.5 };
          c.alignment = { horizontal: col === 1 ? "left" : "right", vertical: "middle" };
          c.border = thin;
          if (col === 3) c.numFmt = MONEY;
        });
      }
      const totCount = [...by.values()].reduce((a, v) => a + v.count, 0);
      const totNet = n2([...by.values()].reduce((a, v) => a + v.net, 0));
      const gt = ws.addRow(["TOTAL", totCount, totNet]);
      gt.eachCell((c, col) => {
        if (col > 3) return;
        c.font = { bold: true, size: 10 };
        c.fill = fill("FFEDE3E6");
        c.border = { ...thin, top: { style: "double", color: { argb: BORDER } } };
        c.alignment = { horizontal: col === 1 ? "left" : "right", vertical: "middle" };
        if (col === 3) c.numFmt = MONEY;
      });
    };

    // Site-wise total (only when >1 site) then designation-wise total (only when
    // >1 designation) — each headcount + Actual-Salary-to-be-Paid, then a grand total.
    const byOrg = new Map<string, { count: number; net: number }>();
    for (const r of rows) {
      const cur = byOrg.get(r.organization) ?? { count: 0, net: 0 };
      cur.count += 1; cur.net += r.net;
      byOrg.set(r.organization, cur);
    }
    if (byOrg.size > 1) addSubtotalTable("Site / Organization-wise total (Actual Salary to be Paid)", "Site", byOrg);

    const byDesig = new Map<string, { count: number; net: number }>();
    for (const r of rows) {
      const cur = byDesig.get(r.designation) ?? { count: 0, net: 0 };
      cur.count += 1; cur.net += r.net;
      byDesig.set(r.designation, cur);
    }
    if (byDesig.size > 1) addSubtotalTable("Designation-wise total (Actual Salary to be Paid)", "Designation", byDesig);

    // Freeze the title + header rows AND the two leftmost grouping columns.
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];

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
