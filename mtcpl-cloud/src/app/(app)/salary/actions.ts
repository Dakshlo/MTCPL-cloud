"use server";

/**
 * Salary / PF department — server actions (mig 189, Daksh Jul 2026).
 *
 * A completely SEPARATE department: employee master (bank + PF details),
 * monthly salary runs (draft → paid), and the PF record that falls out of the
 * paid rows. Touches ONLY salary_employees / salary_payments — nothing else.
 *
 * Flow mirrors Finance's bank-excel habit:
 *   1. add employees once (bank a/c + IFSC + 20-char HDFC beneficiary name);
 *   2. "Prepare month" → one draft row per active employee
 *      (gross = monthly salary, PF = gross × pf% when enabled, net = gross − PF);
 *   3. adjust rows if needed → download the HDFC bulk-payment sheet
 *      (/api/salary/hdfc-export) → pay from the bank → "Mark month paid".
 *
 * Every action redirects back to the SAME working month + tab (return_month /
 * return_tab hidden fields) so preparing/paying a past month never snaps the
 * page back to the current month (review finding — double-prepare hazard).
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { logAudit } from "@/lib/audit";

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function num(fd: FormData, key: string): number {
  const n = Number(txt(fd, key).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** First-of-month key ("2026-07-01") from a month input ("2026-07"). */
function monthKey(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** Redirect back to /salary keeping the working month + tab. */
function goBack(fd: FormData, fallbackTab: "employees" | "month" | "pf", toast: string): never {
  const ym = txt(fd, "return_month");
  const tab = txt(fd, "return_tab") || fallbackTab;
  const q = new URLSearchParams();
  if (/^\d{4}-\d{2}$/.test(ym)) q.set("month", ym);
  q.set("tab", tab);
  q.set("toast", toast);
  redirect(`/salary?${q.toString()}`);
}

async function guard() {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  return { profile, admin: createAdminSupabaseClient() };
}

// ── Employee master ─────────────────────────────────────────────────

export async function upsertSalaryEmployeeAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "employees", t);
  const id = txt(formData, "id");
  const name = txt(formData, "name");
  if (!name) go("Employee name is required");

  // HDFC sheet rule: ≤20 chars, A–Z 0–9 space period only.
  const beneficiary = (txt(formData, "beneficiary_name") || name)
    .toUpperCase().replace(/[^A-Z0-9 .]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20);

  // PF % — blank means "default 12", but an explicit 0 is honoured (never
  // falsy-coerced back to 12; review finding).
  const pfPctRaw = txt(formData, "pf_percent");
  const pfPercent = pfPctRaw === "" ? 12 : num(formData, "pf_percent");

  const row: Record<string, unknown> = {
    name,
    designation: txt(formData, "designation") || null,
    phone: txt(formData, "phone") || null,
    bank_name: txt(formData, "bank_name") || null,
    account_number: txt(formData, "account_number").replace(/\s+/g, "") || null,
    ifsc: txt(formData, "ifsc").toUpperCase().replace(/\s+/g, "") || null,
    beneficiary_name: beneficiary || null,
    monthly_salary: num(formData, "monthly_salary"),
    pf_enabled: txt(formData, "pf_enabled") === "1",
    joined_on: txt(formData, "joined_on") || null,
    notes: txt(formData, "notes") || null,
  };
  // UAN / PF% inputs are disabled (thus NOT submitted) while "PF applicable"
  // is unchecked — only overwrite them when actually present, so unticking PF
  // never wipes a stored UAN (review finding).
  if (formData.has("uan")) row.uan = txt(formData, "uan") || null;
  if (formData.has("pf_percent")) row.pf_percent = pfPercent;

  if (id) {
    const { error } = await admin.from("salary_employees").update({ ...row, updated_at: new Date().toISOString() } as never).eq("id", id);
    if (error) go(`Could not save: ${error.message}`);
    void logAudit(profile.id, "salary_employee_updated", "salary_employee", id, { name });
  } else {
    const { error } = await admin.from("salary_employees").insert({ ...row, created_by: profile.id } as never);
    if (error) go(`Could not add: ${error.message}`);
    void logAudit(profile.id, "salary_employee_added", "salary_employee", name, { name });
  }
  revalidatePath("/salary");
  go(id ? "Employee updated" : "Employee added");
}

/** Active ⇄ inactive (inactive employees are skipped by Prepare month). */
export async function toggleSalaryEmployeeAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "employees", t);
  const id = txt(formData, "id");
  const active = txt(formData, "active") === "1";
  if (!id) go("Missing employee");
  const { error } = await admin.from("salary_employees").update({ is_active: active, updated_at: new Date().toISOString() } as never).eq("id", id);
  if (error) go(`Could not update: ${error.message}`);
  void logAudit(profile.id, active ? "salary_employee_activated" : "salary_employee_deactivated", "salary_employee", id, {});
  revalidatePath("/salary");
  go(active ? "Employee re-activated" : "Employee deactivated");
}

/** Hard delete — owner/developer only; cascades the employee's payment rows. */
export async function deleteSalaryEmployeeAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "employees", t);
  if (!["owner", "developer"].includes(profile.role)) go("Only the owner can delete an employee");
  const id = txt(formData, "id");
  if (!id) go("Missing employee");
  const { error } = await admin.from("salary_employees").delete().eq("id", id);
  if (error) go(`Could not delete: ${error.message}`);
  // Audit AFTER the delete succeeds — never record a deletion that didn't happen.
  void logAudit(profile.id, "salary_employee_deleted", "salary_employee", id, {});
  revalidatePath("/salary");
  go("Employee deleted (with their salary rows)");
}

// ── Monthly run ─────────────────────────────────────────────────────

/** Create one DRAFT row per active employee for the month (skips employees who
 *  already have a row — re-running never duplicates or overwrites edits). */
export async function prepareSalaryMonthAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "month", t);
  const month = monthKey(txt(formData, "month"));
  if (!month) go("Pick a month first");

  const { data: emps, error: e1 } = await admin
    .from("salary_employees")
    .select("id, monthly_salary, pf_enabled, pf_percent")
    .eq("is_active", true);
  if (e1) go(`Could not load employees: ${e1.message}`);
  const employees = (emps ?? []) as Array<{ id: string; monthly_salary: number; pf_enabled: boolean; pf_percent: number }>;
  if (employees.length === 0) go("No active employees yet — add them first");

  const { data: existing } = await admin.from("salary_payments").select("employee_id").eq("month", month!);
  const have = new Set(((existing ?? []) as Array<{ employee_id: string }>).map((r) => r.employee_id));

  const rows = employees.filter((e) => !have.has(e.id)).map((e) => {
    const gross = Number(e.monthly_salary) || 0;
    // An explicit PF% of 0 is honoured — only a missing/invalid value falls
    // back to the 12% default (review finding: `|| 12` ate real zeros).
    const pctRaw = Number(e.pf_percent);
    const pct = Number.isFinite(pctRaw) ? pctRaw : 12;
    const pf = e.pf_enabled ? Math.round(gross * pct) / 100 : 0;
    return { employee_id: e.id, month: month!, gross, pf_amount: pf, other_deduction: 0, addition: 0, net: Math.round((gross - pf) * 100) / 100, status: "draft", created_by: profile.id };
  });
  if (rows.length === 0) go("Every active employee already has a row for this month");

  const { error } = await admin.from("salary_payments").insert(rows as never);
  if (error) go(`Could not prepare: ${error.message}`);
  void logAudit(profile.id, "salary_month_prepared", "salary_month", month!, { rows: rows.length });
  revalidatePath("/salary");
  go(`Prepared ${rows.length} salary row${rows.length === 1 ? "" : "s"}`);
}

/** Edit one DRAFT row's amounts — net recomputed server-side. The UPDATE
 *  itself carries .eq(status,'draft') so a row paid a moment ago in another
 *  tab can never be rewritten (review finding — check-then-act race). */
export async function updateSalaryPaymentAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "month", t);
  const id = txt(formData, "id");
  if (!id) go("Missing row");

  const gross = num(formData, "gross");
  const pf = num(formData, "pf_amount");
  const ded = num(formData, "other_deduction");
  const add = num(formData, "addition");
  const net = Math.round((gross - pf - ded + add) * 100) / 100;
  const { data, error } = await admin.from("salary_payments")
    .update({ gross, pf_amount: pf, other_deduction: ded, addition: add, net, note: txt(formData, "note") || null } as never)
    .eq("id", id).eq("status", "draft")
    .select("id");
  if (error) go(`Could not save: ${error.message}`);
  if ((data ?? []).length === 0) go("Row not found or already PAID — paid rows can't be edited");
  void logAudit(profile.id, "salary_payment_updated", "salary_payment", id, { gross, pf, net });
  revalidatePath("/salary");
  go("Row updated");
}

/** Remove one DRAFT row (employee skipped this month) — same atomic guard. */
export async function removeSalaryPaymentAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "month", t);
  const id = txt(formData, "id");
  if (!id) go("Missing row");
  const { data, error } = await admin.from("salary_payments")
    .delete()
    .eq("id", id).eq("status", "draft")
    .select("id");
  if (error) go(`Could not remove: ${error.message}`);
  if ((data ?? []).length === 0) go("Row not found or already PAID — paid rows can't be removed");
  void logAudit(profile.id, "salary_payment_removed", "salary_payment", id, {});
  revalidatePath("/salary");
  go("Row removed for this month");
}

/** Mark the WHOLE month's draft rows paid (after paying via the bank sheet). */
export async function markSalaryMonthPaidAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "month", t);
  const month = monthKey(txt(formData, "month"));
  if (!month) go("Pick a month first");
  const { data, error } = await admin.from("salary_payments")
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_by: profile.id } as never)
    .eq("month", month!).eq("status", "draft")
    .select("id");
  if (error) go(`Could not mark paid: ${error.message}`);
  const n = (data ?? []).length;
  if (n === 0) go("Nothing in draft for this month");
  void logAudit(profile.id, "salary_month_paid", "salary_month", month!, { rows: n });
  revalidatePath("/salary");
  go(`Marked ${n} salary row${n === 1 ? "" : "s"} PAID`);
}

/** Revert ONE paid row to draft — owner/developer only (mistake fix). */
export async function unmarkSalaryPaymentPaidAction(formData: FormData): Promise<void> {
  const { profile, admin } = await guard();
  const go = (t: string): never => goBack(formData, "month", t);
  if (!["owner", "developer"].includes(profile.role)) go("Only the owner can un-mark a paid salary");
  const id = txt(formData, "id");
  if (!id) go("Missing row");
  const { data, error } = await admin.from("salary_payments")
    .update({ status: "draft", paid_at: null, paid_by: null } as never)
    .eq("id", id).eq("status", "paid")
    .select("id");
  if (error) go(`Could not revert: ${error.message}`);
  if ((data ?? []).length === 0) go("Row is not in PAID state");
  void logAudit(profile.id, "salary_payment_unpaid", "salary_payment", id, {});
  revalidatePath("/salary");
  go("Row moved back to draft");
}
