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
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary, computePf, earnedSalary, salaryTypeForDesignation } from "@/lib/salary-permissions";
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

  // Salary type follows the designation — "Worker" ⇒ paid by attendance,
  // anything else ⇒ fixed. No hand-set toggle any more.
  const designation = txt(formData, "designation") || null;
  const salaryType = salaryTypeForDesignation(designation);
  const row: Record<string, unknown> = {
    name,
    organization: txt(formData, "organization") || null,
    designation,
    father_name: txt(formData, "father_name") || null,
    phone: txt(formData, "phone") || null,
    aadhaar: txt(formData, "aadhaar").replace(/\D/g, "").slice(0, 12) || null,
    bank_name: txt(formData, "bank_name") || null,
    account_number: txt(formData, "account_number").replace(/\s+/g, "") || null,
    ifsc: txt(formData, "ifsc").toUpperCase().replace(/\s+/g, "") || null,
    beneficiary_name: beneficiary || null,
    monthly_salary: num(formData, "monthly_salary"),
    salary_type: salaryType,
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
    .select("id, monthly_salary, pf_enabled, pf_percent, designation")
    .eq("is_active", true);
  if (e1) go(`Could not load employees: ${e1.message}`);
  const employees = (emps ?? []) as Array<{ id: string; monthly_salary: number; pf_enabled: boolean; pf_percent: number; designation: string | null }>;
  if (employees.length === 0) go("No active employees yet — add them first");

  const { data: existing } = await admin.from("salary_payments").select("employee_id").eq("month", month!);
  const have = new Set(((existing ?? []) as Array<{ employee_id: string }>).map((r) => r.employee_id));

  const rows = employees.filter((e) => !have.has(e.id)).map((e) => {
    // Salary type follows the designation. Fixed prefills the full monthly
    // salary; a Worker starts at 0 (attendance is null until the accountant
    // records days present) — earnedSalary() encodes both.
    const salaryType = salaryTypeForDesignation(e.designation);
    const gross = earnedSalary({ monthlySalary: Number(e.monthly_salary) || 0, salaryType, attendanceDays: null, monthKey: month! });
    // PF = pct% of min(gross, ₹15,000 ceiling). Explicit 0% honoured.
    const pf = computePf(gross, Number(e.pf_percent), e.pf_enabled);
    return { employee_id: e.id, month: month!, gross, pf_amount: pf, ot_amount: 0, advance: 0, other_deduction: 0, addition: 0, net: Math.round((gross - pf) * 100) / 100, status: "draft", created_by: profile.id };
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

  // Load the row's month + employee so gross/PF are recomputed AUTHORITATIVELY
  // here (the accountant only enters attendance + OT/advance/deduction/addition —
  // the earned base and PF are DERIVED, never typed).
  const { data: rowData, error: rErr } = await admin
    .from("salary_payments").select("employee_id, month").eq("id", id).maybeSingle();
  if (rErr) go(`Could not load the row: ${rErr.message}`);
  if (!rowData) go("Row not found");
  const r0 = rowData as { employee_id: string; month: string };
  const { data: empData } = await admin
    .from("salary_employees").select("monthly_salary, designation, pf_enabled, pf_percent").eq("id", r0.employee_id).maybeSingle();
  const emp = (empData ?? {}) as { monthly_salary?: number; designation?: string | null; pf_enabled?: boolean; pf_percent?: number };

  const attendanceRaw = txt(formData, "attendance_days");
  const attendance = attendanceRaw === "" ? null : num(formData, "attendance_days");
  const otHoursRaw = txt(formData, "ot_hours");
  const ot = num(formData, "ot_amount");
  const advance = num(formData, "advance");
  const ded = num(formData, "other_deduction");
  const add = num(formData, "addition");

  // Fixed ⇒ full monthly salary whatever the attendance; Worker ⇒ salary ×
  // (attendance ÷ days-in-month). PF follows the earned gross.
  const salaryType = salaryTypeForDesignation(emp.designation ?? null);
  const gross = earnedSalary({ monthlySalary: Number(emp.monthly_salary) || 0, salaryType, attendanceDays: attendance, monthKey: r0.month });
  const pf = computePf(gross, Number(emp.pf_percent), !!emp.pf_enabled);
  // Actual pay = earned − PF + overtime − advance − other deduction + addition.
  const net = Math.round((gross - pf + ot - advance - ded + add) * 100) / 100;

  const { data, error } = await admin.from("salary_payments")
    .update({
      gross, pf_amount: pf, ot_amount: ot, advance, other_deduction: ded, addition: add, net,
      attendance_days: attendance,
      ot_hours: otHoursRaw === "" ? null : num(formData, "ot_hours"),
      remarks: txt(formData, "remarks") || null,
      note: txt(formData, "note") || null,
    } as never)
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

// ── Import employees from an Excel sheet (Daksh Jul 2026) ────────────
// The PF handler already keeps employees in an Excel in exactly our register
// shape. Rather than retype them, upload that sheet: we find the header row and
// map NAME / FATHER / BANK / IFSC / A/C / FIXED SALARY by label, and read the
// designation from the column just left of SR.NO (exceljs fills merged cells,
// so a group label spanning many rows lands on every row). Two-step — parse →
// preview → import — so NOTHING is written until the user confirms.

type ParsedEmp = { name: string; father: string; organization: string; designation: string; bank: string; ifsc: string; account: string; salary: number };

function xlText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in (v as object)) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join("");
    if ("result" in (v as object)) return String((v as { result: unknown }).result ?? "");
    if ("text" in (v as object)) return String((v as { text: unknown }).text ?? "");
    return "";
  }
  return String(v);
}
const xlDigits = (cell: ExcelJS.Cell) => xlText(cell).replace(/\D/g, "");
const xlNum = (cell: ExcelJS.Cell) => { const n = Number(xlText(cell).replace(/[,\s₹]/g, "")); return Number.isFinite(n) ? n : 0; };
const normH = (v: string) => v.replace(/\s+/g, " ").trim().toUpperCase();

export async function parseSalaryImportAction(
  formData: FormData,
): Promise<{ ok: true; rows: Array<ParsedEmp & { dup: boolean; note: string }>; sheet: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) return { ok: false, error: "Not allowed." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an .xlsx file first." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "File too large (max 8 MB)." };

  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
  } catch {
    return { ok: false, error: "Could not read the file — is it a real .xlsx?" };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "The workbook has no sheets." };

  // Locate the header row + map the columns we care about by their labels.
  let headerRow = -1;
  const col: Partial<Record<"name" | "father" | "bank" | "ifsc" | "acc" | "salary" | "sr", number>> = {};
  for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const f: Partial<Record<"name" | "father" | "bank" | "ifsc" | "acc" | "salary" | "sr", number>> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = normH(xlText(row.getCell(c)));
      if (!h) continue;
      if (h === "NAME" && f.name == null) f.name = c;
      else if (h.includes("FATHER") && f.father == null) f.father = c;
      else if (h.includes("BANK") && h.includes("NAME") && f.bank == null) f.bank = c;
      else if (h.includes("IFSC") && f.ifsc == null) f.ifsc = c;
      else if ((h.includes("A/C") || h.includes("ACCOUNT")) && f.acc == null) f.acc = c;
      else if (h.includes("FIXED") && h.includes("SALARY") && f.salary == null) f.salary = c;
      else if (h.includes("SR") && f.sr == null) f.sr = c;
    }
    if (f.name != null && (f.father != null || f.ifsc != null || f.bank != null)) {
      headerRow = r; Object.assign(col, f); break;
    }
  }
  if (headerRow < 0 || col.name == null) {
    return { ok: false, error: "Couldn't find a header row with NAME / FATHER / BANK / IFSC. Use the same column layout as the PF register." };
  }
  // Designation = the column just left of SR.NO (else two left of NAME).
  // Organization / site = one further left again (the handler sheet nests
  // designations under a site column). Both merge-fill via exceljs.
  const desigCol = col.sr != null ? col.sr - 1 : col.name - 2;
  const orgCol = desigCol - 1;

  const parsed: ParsedEmp[] = [];
  let carried = "";
  let carriedOrg = "";
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = xlText(row.getCell(col.name)).replace(/\s+/g, " ").trim();
    if (!name || normH(name) === "TOTAL") continue;
    const desigRaw = desigCol >= 1 ? xlText(row.getCell(desigCol)).replace(/\s+/g, " ").trim() : "";
    if (desigRaw && normH(desigRaw) !== "TOTAL") carried = desigRaw;
    const orgRaw = orgCol >= 1 ? xlText(row.getCell(orgCol)).replace(/\s+/g, " ").trim() : "";
    if (orgRaw && normH(orgRaw) !== "TOTAL") carriedOrg = orgRaw;
    const designation = desigRaw || carried;
    const organization = orgRaw || carriedOrg;
    parsed.push({
      name,
      father: col.father ? xlText(row.getCell(col.father)).replace(/\s+/g, " ").trim() : "",
      // If the two left columns turned out identical (a merged single label),
      // don't duplicate it — keep it as the designation and leave org blank.
      organization: organization && organization !== designation ? organization : "",
      designation,
      bank: col.bank ? xlText(row.getCell(col.bank)).replace(/\s+/g, " ").trim() : "",
      ifsc: col.ifsc ? normH(xlText(row.getCell(col.ifsc))).replace(/\s/g, "") : "",
      account: col.acc ? xlDigits(row.getCell(col.acc)) : "",
      salary: col.salary ? xlNum(row.getCell(col.salary)) : 0,
    });
  }
  if (parsed.length === 0) return { ok: false, error: "No employee rows found under the header." };

  // Flag duplicates against what's already in the DB (by account, then name).
  const admin = createAdminSupabaseClient();
  const { data: existing } = await admin.from("salary_employees").select("name, account_number");
  const existAcc = new Set(((existing ?? []) as Array<{ account_number: string | null }>).map((e) => (e.account_number ?? "").replace(/\D/g, "")).filter(Boolean));
  const existName = new Set(((existing ?? []) as Array<{ name: string | null }>).map((e) => normH(e.name ?? "")).filter(Boolean));
  const seenAcc = new Set<string>();
  const rows = parsed.map((p) => {
    let dup = false; let note = "";
    if (p.account && existAcc.has(p.account)) { dup = true; note = "A/c already in system"; }
    else if (existName.has(normH(p.name))) { dup = true; note = "Name already in system"; }
    else if (p.account && seenAcc.has(p.account)) { dup = true; note = "Duplicate A/c in this file"; }
    if (p.account) seenAcc.add(p.account);
    return { ...p, dup, note };
  });
  return { ok: true, rows, sheet: ws.name };
}

export async function importSalaryEmployeesAction(
  rows: ParsedEmp[],
  pfEnabled: boolean,
): Promise<{ ok: true; inserted: number; skipped: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) return { ok: false, error: "Not allowed." };
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && String(r.name || "").trim());
  if (list.length === 0) return { ok: false, error: "Nothing to import." };

  const admin = createAdminSupabaseClient();
  // Re-check dupes server-side so a stale preview can't double-insert.
  const { data: existing } = await admin.from("salary_employees").select("account_number");
  const existAcc = new Set(((existing ?? []) as Array<{ account_number: string | null }>).map((e) => (e.account_number ?? "").replace(/\D/g, "")).filter(Boolean));

  const toInsert: Array<Record<string, unknown>> = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of list) {
    const acc = String(r.account || "").replace(/\D/g, "");
    if (acc && (existAcc.has(acc) || seen.has(acc))) { skipped += 1; continue; }
    if (acc) seen.add(acc);
    const name = String(r.name).replace(/\s+/g, " ").trim();
    const beneficiary = name.toUpperCase().replace(/[^A-Z0-9 .]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20);
    toInsert.push({
      name,
      father_name: String(r.father || "").trim() || null,
      organization: String(r.organization || "").trim() || null,
      designation: String(r.designation || "").trim() || null,
      bank_name: String(r.bank || "").trim() || null,
      account_number: acc || null,
      ifsc: String(r.ifsc || "").toUpperCase().replace(/\s+/g, "") || null,
      beneficiary_name: beneficiary || null,
      monthly_salary: Number(r.salary) > 0 ? Math.round(Number(r.salary) * 100) / 100 : 0,
      salary_type: salaryTypeForDesignation(String(r.designation || "")),
      pf_enabled: !!pfEnabled,
      pf_percent: 12,
      is_active: true,
      created_by: profile.id,
    });
  }
  if (toInsert.length === 0) return { ok: false, error: `All ${list.length} row(s) already exist — nothing new to import.` };
  const { error } = await admin.from("salary_employees").insert(toInsert as never);
  if (error) return { ok: false, error: error.message };
  void logAudit(profile.id, "salary_employees_imported", "salary_employee", "batch", { inserted: toInsert.length, skipped });
  revalidatePath("/salary");
  return { ok: true, inserted: toInsert.length, skipped };
}
