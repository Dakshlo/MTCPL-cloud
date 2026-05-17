"use server";

/**
 * Mig 060 — server actions for cutter operational expenses + the
 * combined-machines book-value entry that feeds depreciation.
 *
 * Same shape as carving/expenses/actions.ts (mig 054), minus the
 * vendor split: cutter machines are all in-house aggregate, so there's
 * no per-vendor breakdown.
 *
 * Permission gates:
 *   • Operational expenses → canEnterCutterExpenses
 *     (dev / owner / cnc_expense_entry — same person handles both
 *     departments per Daksh's spec).
 *   • Book value entry → canEditCutterBookValue (dev / owner only —
 *     book value drives every future month's depreciation).
 *
 * Audit log actions:
 *   cutter_expense_added / cutter_expense_edited / cutter_expense_cancelled
 *   cutter_book_value_set / cutter_book_value_cancelled
 */

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  canEditCutterBookValue,
  canEnterCutterExpenses,
} from "@/lib/expenses-permissions";

type ActionResult = { ok: true } | { ok: false; error: string };

const CUTTER_CATEGORIES = new Set([
  "electricity",
  "manpower",
  "repair_maintenance",
  "other",
]);

function refreshCutterPaths() {
  revalidatePath("/cutting/expenses");
  revalidatePath("/reports/various-costing");
  revalidatePath("/reports/various-costing/cutter");
}

function txt(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function intOrNaN(formData: FormData, key: string): number {
  const raw = formData.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function numOrNaN(formData: FormData, key: string): number {
  const raw = formData.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// ══════════════════════════════════════════════════════════════════
// Operational expenses
// ══════════════════════════════════════════════════════════════════

export async function addCutterExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCutterExpenses(profile)) {
    return { ok: false, error: "Not allowed to enter cutter expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const year = intOrNaN(formData, "year");
  const month = intOrNaN(formData, "month");
  const category = txt(formData, "category");
  const amount = numOrNaN(formData, "amount");
  const note = txt(formData, "note") || null;

  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return { ok: false, error: "Pick a valid year." };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: "Pick a valid month." };
  }
  if (!CUTTER_CATEGORIES.has(category)) {
    return { ok: false, error: "Pick a category." };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("cutter_expenses")
    .insert({
      year,
      month,
      category,
      amount,
      note,
      entered_by: profile.id,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  void logAudit(profile.id, "cutter_expense_added", "cutter_expense", inserted.id, {
    year,
    month,
    category,
    amount,
  });
  refreshCutterPaths();
  return { ok: true };
}

export async function editCutterExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCutterExpenses(profile)) {
    return { ok: false, error: "Not allowed to edit cutter expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const id = txt(formData, "id");
  const category = txt(formData, "category");
  const amount = numOrNaN(formData, "amount");
  const note = txt(formData, "note") || null;

  if (!id) return { ok: false, error: "Missing expense id." };
  if (!CUTTER_CATEGORIES.has(category)) {
    return { ok: false, error: "Pick a category." };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const { data: existing, error: loadErr } = await supabase
    .from("cutter_expenses")
    .select("id, year, month, amount, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: "Expense not found." };
  if ((existing as { cancelled_at?: string | null }).cancelled_at) {
    return { ok: false, error: "Cannot edit a cancelled expense." };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("cutter_expenses")
    .update({
      category,
      amount,
      note,
      updated_at: now,
      updated_by: profile.id,
    })
    .eq("id", id);
  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(profile.id, "cutter_expense_edited", "cutter_expense", id, {
    before_amount: Number((existing as { amount?: number }).amount ?? 0),
    after_amount: amount,
    category,
  });
  refreshCutterPaths();
  return { ok: true };
}

export async function cancelCutterExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCutterExpenses(profile)) {
    return { ok: false, error: "Not allowed to cancel cutter expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const id = txt(formData, "id");
  if (!id) return { ok: false, error: "Missing expense id." };

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("cutter_expenses")
    .update({
      cancelled_at: now,
      updated_at: now,
      updated_by: profile.id,
    })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("id, year, month, amount, category")
    .maybeSingle();
  if (updErr) return { ok: false, error: updErr.message };
  if (!updated) {
    return { ok: false, error: "Expense already cancelled or not found." };
  }

  void logAudit(profile.id, "cutter_expense_cancelled", "cutter_expense", id, {
    amount: Number((updated as { amount?: number }).amount ?? 0),
    category: (updated as { category?: string }).category,
  });
  refreshCutterPaths();
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
// Book value — depreciation source (singleton-ish)
// ══════════════════════════════════════════════════════════════════

/** Insert a new book-value snapshot. The latest non-cancelled row
 *  whose effective_from <= period_end is what the report uses. So
 *  inserting a new row is how you "update" the book value going
 *  forward; the prior row stays for historical periods. */
export async function setCutterBookValueAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEditCutterBookValue(profile)) {
    return {
      ok: false,
      error: "Only developer / owner can set the cutter book value.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const bookValue = numOrNaN(formData, "book_value");
  const lifeYears = intOrNaN(formData, "useful_life_years");
  const effectiveFrom = txt(formData, "effective_from");
  const note = txt(formData, "note") || null;

  if (!Number.isFinite(bookValue) || bookValue < 0) {
    return { ok: false, error: "Book value must be a positive number." };
  }
  if (!Number.isFinite(lifeYears) || lifeYears < 1 || lifeYears > 50) {
    return { ok: false, error: "Useful life must be between 1 and 50 years." };
  }
  // effective_from optional — DB defaults to today if empty.

  const insertPayload: Record<string, unknown> = {
    book_value: bookValue,
    useful_life_years: lifeYears,
    note,
    entered_by: profile.id,
  };
  if (effectiveFrom) insertPayload.effective_from = effectiveFrom;

  const { data: inserted, error: insErr } = await supabase
    .from("cutter_book_values")
    .insert(insertPayload)
    .select("id, effective_from")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  void logAudit(
    profile.id,
    "cutter_book_value_set",
    "cutter_book_value",
    inserted.id,
    {
      book_value: bookValue,
      useful_life_years: lifeYears,
      effective_from: (inserted as { effective_from?: string }).effective_from,
    },
  );
  refreshCutterPaths();
  return { ok: true };
}

export async function cancelCutterBookValueAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEditCutterBookValue(profile)) {
    return {
      ok: false,
      error: "Only developer / owner can cancel a cutter book-value entry.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const id = txt(formData, "id");
  if (!id) return { ok: false, error: "Missing book-value id." };

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("cutter_book_values")
    .update({ cancelled_at: now })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("id, book_value, useful_life_years, effective_from")
    .maybeSingle();
  if (updErr) return { ok: false, error: updErr.message };
  if (!updated) {
    return { ok: false, error: "Book-value entry already cancelled or not found." };
  }

  void logAudit(
    profile.id,
    "cutter_book_value_cancelled",
    "cutter_book_value",
    id,
    {
      book_value: Number((updated as { book_value?: number }).book_value ?? 0),
      effective_from: (updated as { effective_from?: string }).effective_from,
    },
  );
  refreshCutterPaths();
  return { ok: true };
}
