/**
 * Salary / PF department — landing page (mig 189, Daksh Jul 2026).
 *
 * Three tabs (client): 👥 Employees (master with bank + PF details) ·
 * 💵 Pay month (prepare → adjust → HDFC bulk sheet → mark paid) ·
 * 🏦 PF record (per-employee deducted-PF trail from paid months).
 *
 * Completely separate department: reads ONLY salary_employees +
 * salary_payments. ?month=YYYY-MM picks the working month (default: current
 * month in IST).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary, salaryTypeForDesignation } from "@/lib/salary-permissions";
import { SalaryClient, type SalaryEmployee, type SalaryPaymentRow, type PfRow } from "./salary-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ month?: string; tab?: string; toast?: string }>;

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

export default async function SalaryPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  // Working month — ?month=YYYY-MM or the current IST month.
  const now = istNow();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthYm = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : fallback;
  const monthKey = `${monthYm}-01`;

  // Best-effort: a pre-mig-189 deploy shows the run-migration banner instead
  // of a 500.
  let needsMigration = false;

  // ── Employees ─────────────────────────────────────────────────────
  let employees: SalaryEmployee[] = [];
  {
    const { data, error } = await admin
      .from("salary_employees")
      .select("*")
      .order("is_active", { ascending: false })
      .order("name");
    if (error) needsMigration = true;
    else {
      employees = ((data ?? []) as Array<Record<string, unknown>>).map((e) => ({
        id: String(e.id),
        name: String(e.name ?? ""),
        organization: (e.organization as string | null) ?? null,
        designation: (e.designation as string | null) ?? null,
        fatherName: (e.father_name as string | null) ?? null,
        phone: (e.phone as string | null) ?? null,
        aadhaar: (e.aadhaar as string | null) ?? null,
        bankName: (e.bank_name as string | null) ?? null,
        accountNumber: (e.account_number as string | null) ?? null,
        ifsc: (e.ifsc as string | null) ?? null,
        beneficiaryName: (e.beneficiary_name as string | null) ?? null,
        monthlySalary: Number(e.monthly_salary) || 0,
        // Salary type follows the designation ("Worker" ⇒ by attendance),
        // derived at read time so the rule applies to every employee — even
        // ones added before the stored salary_type column existed.
        salaryType: salaryTypeForDesignation((e.designation as string | null) ?? null),
        pfEnabled: !!e.pf_enabled,
        uan: (e.uan as string | null) ?? null,
        // An explicit 0% is a real value — only a missing/garbage one shows 12.
        pfPercent: Number.isFinite(Number(e.pf_percent)) ? Number(e.pf_percent) : 12,
        joinedOn: (e.joined_on as string | null) ?? null,
        isActive: !!e.is_active,
        notes: (e.notes as string | null) ?? null,
      }));
    }
  }

  // ── The working month's rows ──────────────────────────────────────
  let monthRows: SalaryPaymentRow[] = [];
  if (!needsMigration) {
    const { data, error } = await admin
      .from("salary_payments")
      .select("id, employee_id, month, gross, pf_amount, ot_amount, ot_hours, advance, attendance_days, remarks, other_deduction, addition, net, note, status, paid_at")
      .eq("month", monthKey);
    if (!error) {
      const nameOf = new Map(employees.map((e) => [e.id, e] as const));
      monthRows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const emp = nameOf.get(String(r.employee_id));
        return {
          id: String(r.id),
          employeeId: String(r.employee_id),
          employeeName: emp?.name ?? "—",
          organization: emp?.organization ?? null,
          designation: emp?.designation ?? null,
          salaryType: emp?.salaryType ?? "fixed",
          // For the RowModal's live gross/PF preview (worker proration).
          monthlySalary: emp?.monthlySalary ?? 0,
          pfEnabled: emp?.pfEnabled ?? false,
          pfPercent: emp?.pfPercent ?? 12,
          hasBank: !!(emp?.accountNumber && (emp?.beneficiaryName || emp?.name)),
          gross: Number(r.gross) || 0,
          pfAmount: Number(r.pf_amount) || 0,
          otAmount: Number(r.ot_amount) || 0,
          otHours: r.ot_hours == null ? null : Number(r.ot_hours),
          advance: Number(r.advance) || 0,
          attendanceDays: r.attendance_days == null ? null : Number(r.attendance_days),
          remarks: (r.remarks as string | null) ?? null,
          otherDeduction: Number(r.other_deduction) || 0,
          addition: Number(r.addition) || 0,
          net: Number(r.net) || 0,
          note: (r.note as string | null) ?? null,
          status: (r.status as "draft" | "paid") ?? "draft",
          paidAt: (r.paid_at as string | null) ?? null,
        };
      }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }
  }

  // ── PF record — every PAID row with PF deducted. PAGED: PostgREST clamps
  // any single response at 1000 rows (repo-wide gotcha), and this is the
  // authoritative till-date PF trail — silent truncation would understate it.
  let pfRows: PfRow[] = [];
  if (!needsMigration) {
    for (let off = 0; off < 100_000; off += 1000) {
      const { data, error } = await admin
        .from("salary_payments")
        .select("employee_id, month, pf_amount")
        .eq("status", "paid")
        .gt("pf_amount", 0)
        .order("month", { ascending: false })
        .range(off, off + 999);
      if (error) break;
      const chunk = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        employeeId: String(r.employee_id),
        month: String(r.month),
        pfAmount: Number(r.pf_amount) || 0,
      }));
      pfRows.push(...chunk);
      if (chunk.length < 1000) break;
    }
  }

  return (
    <section className="page-card">
      {needsMigration && (
        <div style={{ marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          ⚠ Run migration <span style={{ fontFamily: "ui-monospace, monospace" }}>189_salary_pf.sql</span> on Supabase to switch the Salary / PF department on.
        </div>
      )}
      <SalaryClient
        me={{ id: profile.id, isBoss: profile.role === "owner" || profile.role === "developer" }}
        employees={employees}
        organizations={[...new Set(employees.map((e) => (e.organization ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))}
        designations={[...new Set(["Worker", ...employees.map((e) => (e.designation ?? "").trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b))}
        monthYm={monthYm}
        monthRows={monthRows}
        pfRows={pfRows}
        initialTab={sp.tab === "month" || sp.tab === "pf" ? sp.tab : employees.length === 0 ? "employees" : "month"}
      />
    </section>
  );
}
