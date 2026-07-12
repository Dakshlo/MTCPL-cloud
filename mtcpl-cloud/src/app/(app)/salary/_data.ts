// Server-side data loaders for the Employees department pages (Employees ·
// Pay salary · Records). Shared so the three pages stay thin. Reads ONLY
// salary_employees / salary_payments / salary_batches.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { SalaryEmployee, SalaryPaymentRow, SalaryBatch, PaidRow } from "./salary-types";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

function mapEmployee(e: Record<string, unknown>): SalaryEmployee {
  return {
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
    dailySalary: e.daily_salary == null ? null : Number(e.daily_salary),
    salaryType: (e.salary_type as string) === "variable" ? "variable" : "fixed",
    pfEnabled: !!e.pf_enabled,
    uan: (e.uan as string | null) ?? null,
    pfPercent: Number.isFinite(Number(e.pf_percent)) ? Number(e.pf_percent) : 12,
    esiEnabled: !!e.esi_enabled,
    esiNumber: (e.esi_number as string | null) ?? null,
    esiPercent: Number.isFinite(Number(e.esi_percent)) ? Number(e.esi_percent) : 0.75,
    tdsEnabled: !!e.tds_enabled,
    tdsPercent: Number.isFinite(Number(e.tds_percent)) ? Number(e.tds_percent) : 10,
    joinedOn: (e.joined_on as string | null) ?? null,
    isActive: !!e.is_active,
    notes: (e.notes as string | null) ?? null,
  };
}

/** Employees + whether the department (mig 189) / ESI + daily-wage (mig 193/194)
 *  are on. Detects the newer columns with an explicit probe so it's right even
 *  with zero employees or a half-applied 193-but-not-194 DB. */
export async function loadEmployees(admin: Admin): Promise<{ employees: SalaryEmployee[]; needsMigration: boolean; needs193: boolean }> {
  const { data, error } = await admin
    .from("salary_employees").select("*").order("is_active", { ascending: false }).order("name");
  if (error) return { employees: [], needsMigration: true, needs193: false };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // Probe the mig-193 (esi_enabled) + 194 (daily_salary) + 196 (tds_enabled)
  // columns — errors if ANY is missing, regardless of row count.
  const { error: probeErr } = await admin.from("salary_employees").select("esi_enabled, daily_salary, tds_enabled").limit(1);
  return { employees: rows.map(mapEmployee), needsMigration: false, needs193: !!probeErr };
}

export function orgOptions(employees: SalaryEmployee[]): string[] {
  return [...new Set(employees.map((e) => (e.organization ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function desigOptions(employees: SalaryEmployee[]): string[] {
  return [...new Set(employees.map((e) => (e.designation ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function loadMonthRows(admin: Admin, monthKey: string, employees: SalaryEmployee[]): Promise<SalaryPaymentRow[]> {
  const empOf = new Map(employees.map((e) => [e.id, e] as const));
  const { data, error } = await admin.from("salary_payments").select("*").eq("month", monthKey);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const emp = empOf.get(String(r.employee_id));
    return {
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeName: emp?.name ?? "—",
      organization: emp?.organization ?? null,
      designation: emp?.designation ?? null,
      salaryType: emp?.salaryType ?? "fixed",
      monthlySalary: emp?.monthlySalary ?? 0,
      dailySalary: emp?.dailySalary ?? null,
      pfEnabled: emp?.pfEnabled ?? false,
      pfPercent: emp?.pfPercent ?? 12,
      esiEnabled: emp?.esiEnabled ?? false,
      esiPercent: emp?.esiPercent ?? 0.75,
      tdsEnabled: emp?.tdsEnabled ?? false,
      tdsPercent: emp?.tdsPercent ?? 10,
      hasBank: !!(emp?.accountNumber && emp?.ifsc && (emp?.beneficiaryName || emp?.name)),
      batchId: (r.batch_id as string | null) ?? null,
      gross: Number(r.gross) || 0,
      pfAmount: Number(r.pf_amount) || 0,
      esiAmount: Number(r.esi_amount) || 0,
      tdsAmount: Number(r.tds_amount) || 0,
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

export async function loadBatches(admin: Admin, monthKey: string): Promise<{ batches: SalaryBatch[]; needs193: boolean }> {
  const { data, error } = await admin
    .from("salary_batches").select("*").eq("month", monthKey).order("created_at", { ascending: true });
  if (error) return { batches: [], needs193: true };
  const batches = ((data ?? []) as Array<Record<string, unknown>>).map((b) => ({
    id: String(b.id),
    label: String(b.label ?? "Batch"),
    status: (b.status as string) === "paid" ? ("paid" as const) : ("draft" as const),
    hdfcGeneratedAt: (b.hdfc_generated_at as string | null) ?? null,
    paidAt: (b.paid_at as string | null) ?? null,
    createdAt: String(b.created_at ?? ""),
  }));
  return { batches, needs193: false };
}

/** Every PAID row (all months) — paged past PostgREST's 1000-row cap. */
export async function loadPaidRows(admin: Admin): Promise<PaidRow[]> {
  const out: PaidRow[] = [];
  for (let off = 0; off < 100_000; off += 1000) {
    const { data, error } = await admin
      .from("salary_payments").select("*").eq("status", "paid").order("month", { ascending: false }).range(off, off + 999);
    if (error) break;
    const chunk = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      employeeId: String(r.employee_id),
      month: String(r.month),
      net: Number(r.net) || 0,
      pfAmount: Number(r.pf_amount) || 0,
      esiAmount: Number(r.esi_amount) || 0,
      paidAt: (r.paid_at as string | null) ?? null,
    }));
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}
