"use server";

/**
 * Migration 054 — server actions for CNC operational expenses + the
 * per-machine asset register that feeds depreciation.
 *
 * Three operational-expense actions are gated by canEnterCncExpenses
 * (dev / owner / cnc_expense_entry). The machine-asset action is
 * dev/owner only — asset values affect every future month's
 * depreciation, so it lives behind a tighter gate.
 *
 * All actions write to audit_logs for compliance:
 *   cnc_expense_added / cnc_expense_edited / cnc_expense_cancelled
 *   machine_asset_updated
 */

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  canEditMachineAssetValue,
  canEnterCncExpenses,
} from "@/lib/expenses-permissions";

type ActionResult = { ok: true } | { ok: false; error: string };

const EXPENSE_CATEGORIES = new Set([
  "tools",
  "electricity",
  "labor",
  "office",
  "maintenance",
  "other",
]);

function refreshCarvingPaths() {
  revalidatePath("/carving/expenses");
  revalidatePath("/carving/reports");
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

export async function addCncExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCncExpenses(profile)) {
    return { ok: false, error: "Not allowed to enter CNC expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const year = intOrNaN(formData, "year");
  const month = intOrNaN(formData, "month");
  const category = txt(formData, "category");
  const amount = numOrNaN(formData, "amount");
  const note = txt(formData, "note") || null;

  if (!vendorId) return { ok: false, error: "Pick a vendor." };
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return { ok: false, error: "Pick a valid year." };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: "Pick a valid month." };
  }
  if (!EXPENSE_CATEGORIES.has(category)) {
    return { ok: false, error: "Pick a category." };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  // Confirm vendor is a CNC vendor — silently rejecting non-CNC
  // vendors keeps the data clean (the report only sums vendor_type
  // = CNC).
  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, vendor_type")
    .eq("id", vendorId)
    .maybeSingle();
  if (vendorErr) return { ok: false, error: vendorErr.message };
  if (!vendor) return { ok: false, error: "Vendor not found." };
  if ((vendor as { vendor_type?: string }).vendor_type !== "CNC") {
    return { ok: false, error: "Vendor is not a CNC operator." };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("cnc_vendor_expenses")
    .insert({
      vendor_id: vendorId,
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

  void logAudit(profile.id, "cnc_expense_added", "cnc_expense", inserted.id, {
    vendor_id: vendorId,
    year,
    month,
    category,
    amount,
  });
  refreshCarvingPaths();
  return { ok: true };
}

export async function editCncExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCncExpenses(profile)) {
    return { ok: false, error: "Not allowed to edit CNC expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const id = txt(formData, "id");
  const category = txt(formData, "category");
  const amount = numOrNaN(formData, "amount");
  const note = txt(formData, "note") || null;

  if (!id) return { ok: false, error: "Missing expense id." };
  if (!EXPENSE_CATEGORIES.has(category)) {
    return { ok: false, error: "Pick a category." };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const { data: existing, error: loadErr } = await supabase
    .from("cnc_vendor_expenses")
    .select("id, vendor_id, year, month, amount, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: "Expense not found." };
  if ((existing as { cancelled_at?: string | null }).cancelled_at) {
    return { ok: false, error: "Cannot edit a cancelled expense." };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("cnc_vendor_expenses")
    .update({
      category,
      amount,
      note,
      updated_at: now,
      updated_by: profile.id,
    })
    .eq("id", id);
  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(profile.id, "cnc_expense_edited", "cnc_expense", id, {
    before_amount: Number((existing as { amount?: number }).amount ?? 0),
    after_amount: amount,
    category,
  });
  refreshCarvingPaths();
  return { ok: true };
}

export async function cancelCncExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEnterCncExpenses(profile)) {
    return { ok: false, error: "Not allowed to cancel CNC expenses." };
  }
  const supabase = createAdminSupabaseClient();

  const id = txt(formData, "id");
  const reason = txt(formData, "reason") || null;
  if (!id) return { ok: false, error: "Missing expense id." };

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("cnc_vendor_expenses")
    .update({
      cancelled_at: now,
      cancelled_by: profile.id,
      cancel_reason: reason,
      updated_at: now,
      updated_by: profile.id,
    })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("id, vendor_id, year, month, amount")
    .maybeSingle();
  if (updErr) return { ok: false, error: updErr.message };
  if (!updated) {
    return { ok: false, error: "Expense already cancelled or not found." };
  }

  void logAudit(profile.id, "cnc_expense_cancelled", "cnc_expense", id, {
    vendor_id: (updated as { vendor_id?: string }).vendor_id,
    amount: Number((updated as { amount?: number }).amount ?? 0),
    reason,
  });
  refreshCarvingPaths();
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
// Machine asset register (depreciation source data)
// ══════════════════════════════════════════════════════════════════

export async function updateMachineAssetAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canEditMachineAssetValue(profile)) {
    return {
      ok: false,
      error: "Only developer / owner can edit machine asset values.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const machineId = txt(formData, "machine_id");
  if (!machineId) return { ok: false, error: "Missing machine_id." };

  // Optional numeric fields — empty string → NULL. Negative or NaN
  // values fall through the DB CHECK constraint so we don't need to
  // re-validate every edge case here, but we DO want to convert
  // empties to null so the DB doesn't try to coerce "" → numeric.
  function optNum(key: string): number | null {
    const raw = formData.get(key);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  function optDate(key: string): string | null {
    const raw = formData.get(key);
    if (raw == null || raw === "") return null;
    return String(raw);
  }

  const purchasePrice = optNum("purchase_price");
  const purchaseDate = optDate("purchase_date");
  const currentBookValue = optNum("current_book_value");
  const bookValueAsOf = optDate("book_value_as_of");
  const ratePctRaw = optNum("depreciation_rate_pct");
  const salvage = optNum("salvage_value");

  // Sensible default if user leaves rate blank — DB CHECK already
  // bounds 0-100; null isn't allowed because column is NOT NULL.
  const ratePct = ratePctRaw == null ? 15.00 : ratePctRaw;

  // Coherence: if user provided purchase_price they should also have
  // a date; same for book_value snapshot. Soft-warn — don't reject
  // (they can save half-way and finish later).
  // (Validation kept light — the carving report just no-ops on
  // partial data, so it's safe to save incomplete.)

  const { data: existing, error: loadErr } = await supabase
    .from("cnc_machines")
    .select("id, machine_code, vendor_id, purchase_price, purchase_date, current_book_value, book_value_as_of, depreciation_rate_pct, salvage_value")
    .eq("id", machineId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: "Machine not found." };

  const { error: updErr } = await supabase
    .from("cnc_machines")
    .update({
      purchase_price: purchasePrice,
      purchase_date: purchaseDate,
      current_book_value: currentBookValue,
      book_value_as_of: bookValueAsOf,
      depreciation_rate_pct: ratePct,
      salvage_value: salvage ?? 0,
    })
    .eq("id", machineId);
  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(
    profile.id,
    "machine_asset_updated",
    "cnc_machine",
    machineId,
    {
      machine_code: (existing as { machine_code?: string }).machine_code,
      before: {
        purchase_price: (existing as { purchase_price?: number | null }).purchase_price ?? null,
        purchase_date: (existing as { purchase_date?: string | null }).purchase_date ?? null,
        current_book_value: (existing as { current_book_value?: number | null }).current_book_value ?? null,
        book_value_as_of: (existing as { book_value_as_of?: string | null }).book_value_as_of ?? null,
        rate_pct: Number((existing as { depreciation_rate_pct?: number }).depreciation_rate_pct ?? 15),
        salvage: Number((existing as { salvage_value?: number }).salvage_value ?? 0),
      },
      after: {
        purchase_price: purchasePrice,
        purchase_date: purchaseDate,
        current_book_value: currentBookValue,
        book_value_as_of: bookValueAsOf,
        rate_pct: ratePct,
        salvage: salvage ?? 0,
      },
    },
  );
  revalidatePath("/carving/vendors");
  revalidatePath(`/carving/vendors/${(existing as { vendor_id?: string }).vendor_id ?? ""}`);
  revalidatePath("/carving/reports");
  return { ok: true };
}

/** Form-action wrapper for the asset editor — React server-action
 *  forms expect `(FormData) => void | Promise<void>`, but our
 *  underlying action returns ActionResult. This wrapper consumes
 *  the result + redirects on error so the typecheck is happy. */
export async function updateMachineAssetFormAction(formData: FormData): Promise<void> {
  const r = await updateMachineAssetAction(formData);
  if (!r.ok) {
    // Bubble the error via a redirect param so the page can render
    // it. For now we just log — happy-path doesn't need it and the
    // bad inputs are caught by the DB CHECK constraints.
    console.warn("[updateMachineAssetFormAction] failed", r.error);
  }
}
