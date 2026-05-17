/**
 * Mig 060 — Cutter operational expense entry page.
 *
 * Same shape as /carving/expenses but simpler: there's no per-vendor
 * split (cutter machines are in-house, aggregate-only), so the page
 * is a single expenses card + the book-value snapshot panel above
 * it. The book-value panel is dev/owner only (canEditCutterBookValue);
 * the expenses card is anyone who canEnterCutterExpenses (which
 * includes cnc_expense_entry).
 *
 * Layout:
 *   • Header strip — Year + Month picker (GET form, defaults to
 *     current IST month).
 *   • Book value panel — current snapshot + "Set new value" SidePanel
 *     trigger (dev/owner only). Drives the depreciation column on
 *     the cutter report.
 *   • Expenses card — line items grouped by category, with add/edit/
 *     cancel inline. Sums into the bottom total.
 *   • Sticky footer — month total + prev / next month nav.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canEnterCutterExpenses,
  canEditCutterBookValue,
} from "@/lib/expenses-permissions";
import { getProfilesMap } from "@/lib/profiles";
import {
  addCutterExpenseAction,
  cancelCutterBookValueAction,
  cancelCutterExpenseAction,
  editCutterExpenseAction,
  setCutterBookValueAction,
} from "./actions";
import {
  CutterExpensesClient,
  type CutterExpenseRow,
  type CutterBookValueRow,
} from "./expenses-client";

type Search = Promise<{ year?: string; month?: string }>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function istTodayParts(): { year: number; month: number } {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export default async function CutterExpensesPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canEnterCutterExpenses(profile)) {
    redirect("/");
  }

  const sp = await searchParams;
  const today = istTodayParts();
  const year = Math.min(2100, Math.max(2020, Number(sp.year) || today.year));
  const month = Math.min(12, Math.max(1, Number(sp.month) || today.month));

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // ── Live expenses for the selected month ──────────────────────
  const { data: expensesRaw } = await supabase
    .from("cutter_expenses")
    .select(
      "id, year, month, category, amount, note, entered_by, entered_at, updated_at, updated_by",
    )
    .eq("year", year)
    .eq("month", month)
    .is("cancelled_at", null)
    .order("entered_at", { ascending: false });

  const expenses: CutterExpenseRow[] = ((expensesRaw ?? []) as Array<{
    id: string;
    year: number;
    month: number;
    category: string;
    amount: number;
    note: string | null;
    entered_by: string | null;
    entered_at: string;
    updated_at: string;
    updated_by: string | null;
  }>).map((e) => ({
    id: e.id,
    year: e.year,
    month: e.month,
    category: e.category as CutterExpenseRow["category"],
    amount: Number(e.amount ?? 0),
    note: e.note,
    enteredByName: e.entered_by ? profilesMap[e.entered_by] ?? "Unknown" : null,
    enteredAt: e.entered_at,
    updatedAt: e.updated_at,
    updatedByName: e.updated_by ? profilesMap[e.updated_by] ?? "Unknown" : null,
  }));

  // ── Book value history (latest first) ─────────────────────────
  const { data: bvRaw } = await supabase
    .from("cutter_book_values")
    .select("id, book_value, useful_life_years, effective_from, note, entered_by, entered_at, cancelled_at")
    .is("cancelled_at", null)
    .order("effective_from", { ascending: false })
    .limit(10);
  const bookValues: CutterBookValueRow[] = ((bvRaw ?? []) as Array<{
    id: string;
    book_value: number | string;
    useful_life_years: number;
    effective_from: string;
    note: string | null;
    entered_by: string | null;
    entered_at: string;
    cancelled_at: string | null;
  }>).map((b) => ({
    id: b.id,
    bookValue: Number(b.book_value ?? 0),
    usefulLifeYears: Number(b.useful_life_years ?? 10),
    effectiveFrom: b.effective_from,
    note: b.note,
    enteredByName: b.entered_by ? profilesMap[b.entered_by] ?? "Unknown" : null,
    enteredAt: b.entered_at,
  }));

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const prevHref = `/cutting/expenses?year=${prevMonth.y}&month=${pad2(prevMonth.m)}`;
  const nextHref = `/cutting/expenses?year=${nextMonth.y}&month=${pad2(nextMonth.m)}`;

  return (
    <CutterExpensesClient
      monthLabel={monthLabel}
      year={year}
      month={month}
      expenses={expenses}
      bookValues={bookValues}
      canEditBookValue={canEditCutterBookValue(profile)}
      prevHref={prevHref}
      nextHref={nextHref}
      addAction={addCutterExpenseAction}
      editAction={editCutterExpenseAction}
      cancelAction={cancelCutterExpenseAction}
      setBookValueAction={setCutterBookValueAction}
      cancelBookValueAction={cancelCutterBookValueAction}
    />
  );
}
