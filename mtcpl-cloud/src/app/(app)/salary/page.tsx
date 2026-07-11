/**
 * Employees department — landing page (mig 189 + 193, Daksh Jul 2026).
 *
 * Five tabs (client): 👥 Employees (master with bank + PF + ESI details) ·
 * 💵 Pay month (prepare BATCHES → adjust → HDFC sheet per batch → mark paid) ·
 * 📊 Salary paid (month-wise paid totals, employee-wise) ·
 * 🏛 PF record · 🏥 ESI record (deduction trails from paid months).
 *
 * Completely separate department: reads ONLY salary_employees +
 * salary_payments + salary_batches. ?month=YYYY-MM picks the working month
 * (default: current month in IST).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { SalaryClient, type SalaryEmployee, type SalaryPaymentRow, type SalaryBatch, type PaidRow } from "./salary-client";

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

  // Best-effort: a pre-migration deploy shows the run-migration banner instead
  // of a 500.
  let needsMigration = false; // mig 189 (tables missing entirely)
  let needsMigration193 = false; // mig 193 (ESI + batches)

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
        // Explicit per-employee toggle: fixed (default) or by attendance.
        salaryType: (e.salary_type as string) === "variable" ? "variable" : "fixed",
        pfEnabled: !!e.pf_enabled,
        uan: (e.uan as string | null) ?? null,
        // An explicit 0% is a real value — only a missing/garbage one shows 12.
        pfPercent: Number.isFinite(Number(e.pf_percent)) ? Number(e.pf_percent) : 12,
        // ESI (mig 193) — default 1% when the column isn't there yet.
        esiEnabled: !!e.esi_enabled,
        esiNumber: (e.esi_number as string | null) ?? null,
        esiPercent: Number.isFinite(Number(e.esi_percent)) ? Number(e.esi_percent) : 1,
        joinedOn: (e.joined_on as string | null) ?? null,
        isActive: !!e.is_active,
        notes: (e.notes as string | null) ?? null,
      }));
      if ((data ?? []).length > 0 && !("esi_enabled" in ((data ?? [])[0] as Record<string, unknown>))) {
        needsMigration193 = true;
      }
    }
  }
  const empOf = new Map(employees.map((e) => [e.id, e] as const));

  // ── The working month's rows ──────────────────────────────────────
  let monthRows: SalaryPaymentRow[] = [];
  if (!needsMigration) {
    const { data, error } = await admin
      .from("salary_payments")
      .select("*")
      .eq("month", monthKey);
    if (!error) {
      monthRows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const emp = empOf.get(String(r.employee_id));
        return {
          id: String(r.id),
          employeeId: String(r.employee_id),
          employeeName: emp?.name ?? "—",
          organization: emp?.organization ?? null,
          designation: emp?.designation ?? null,
          salaryType: emp?.salaryType ?? "fixed",
          // For the RowModal's live gross/PF/ESI preview.
          monthlySalary: emp?.monthlySalary ?? 0,
          pfEnabled: emp?.pfEnabled ?? false,
          pfPercent: emp?.pfPercent ?? 12,
          esiEnabled: emp?.esiEnabled ?? false,
          esiPercent: emp?.esiPercent ?? 1,
          hasBank: !!(emp?.accountNumber && (emp?.beneficiaryName || emp?.name)),
          batchId: (r.batch_id as string | null) ?? null,
          gross: Number(r.gross) || 0,
          pfAmount: Number(r.pf_amount) || 0,
          esiAmount: Number(r.esi_amount) || 0,
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

  // ── This month's batches (mig 193) ────────────────────────────────
  let batches: SalaryBatch[] = [];
  if (!needsMigration) {
    const { data, error } = await admin
      .from("salary_batches")
      .select("*")
      .eq("month", monthKey)
      .order("created_at", { ascending: true });
    if (error) needsMigration193 = true;
    else {
      batches = ((data ?? []) as Array<Record<string, unknown>>).map((b) => ({
        id: String(b.id),
        label: String(b.label ?? "Batch"),
        status: (b.status as string) === "paid" ? "paid" : "draft",
        hdfcGeneratedAt: (b.hdfc_generated_at as string | null) ?? null,
        paidAt: (b.paid_at as string | null) ?? null,
        createdAt: String(b.created_at ?? ""),
      }));
    }
  }

  // ── Every PAID row (all months) — feeds the Salary-paid, PF and ESI
  // record tabs. PAGED: PostgREST clamps any single response at 1000 rows
  // (repo-wide gotcha) and this is the authoritative till-date trail.
  const paidRows: PaidRow[] = [];
  if (!needsMigration) {
    for (let off = 0; off < 100_000; off += 1000) {
      const { data, error } = await admin
        .from("salary_payments")
        .select("*")
        .eq("status", "paid")
        .order("month", { ascending: false })
        .range(off, off + 999);
      if (error) break;
      const chunk = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        employeeId: String(r.employee_id),
        month: String(r.month),
        net: Number(r.net) || 0,
        pfAmount: Number(r.pf_amount) || 0,
        esiAmount: Number(r.esi_amount) || 0,
        paidAt: (r.paid_at as string | null) ?? null,
      }));
      paidRows.push(...chunk);
      if (chunk.length < 1000) break;
    }
  }

  const tab = sp.tab;
  const validTabs = ["employees", "month", "paid", "pf", "esi"] as const;
  const initialTab = (validTabs as readonly string[]).includes(tab ?? "")
    ? (tab as (typeof validTabs)[number])
    : employees.length === 0 ? "employees" : "month";

  return (
    <section className="page-card">
      {needsMigration && (
        <div style={{ marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          ⚠ Run migration <span style={{ fontFamily: "ui-monospace, monospace" }}>189_salary_pf.sql</span> on Supabase to switch the Employees department on.
        </div>
      )}
      {!needsMigration && needsMigration193 && (
        <div style={{ marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          ⚠ Run migration <span style={{ fontFamily: "ui-monospace, monospace" }}>193_salary_esi_batches.sql</span> on Supabase to enable ESI + payment batches.
        </div>
      )}
      <SalaryClient
        me={{ id: profile.id, isBoss: profile.role === "owner" || profile.role === "developer" }}
        employees={employees}
        organizations={[...new Set(employees.map((e) => (e.organization ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))}
        designations={[...new Set(employees.map((e) => (e.designation ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))}
        monthYm={monthYm}
        monthRows={monthRows}
        batches={batches}
        paidRows={paidRows}
        initialTab={initialTab}
      />
    </section>
  );
}
