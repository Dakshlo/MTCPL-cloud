/**
 * Migration 054 — CNC operational expense entry page.
 *
 * Daksh's dad wants cost-per-CFT analysis on the carving monthly
 * report. This page is the data-entry surface for the operational
 * side (tools, electricity, labor, office, maintenance, other).
 *
 * Auth: canEnterCncExpenses (dev / owner / cnc_expense_entry).
 *
 * Layout:
 *   • Top strip — Year + Month picker (defaults to current IST
 *     month). GET form → page re-renders with selected month.
 *   • Per-vendor cards — one per CNC vendor (alphabetical). Each
 *     shows total + add form + line items with edit / cancel.
 *   • Sticky bottom bar — grand total + prev/next month nav.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canEnterCncExpenses } from "@/lib/expenses-permissions";
import { getProfilesMap } from "@/lib/profiles";
import {
  addCncExpenseAction,
  addPlantElectricityAction,
  cancelCncExpenseAction,
  cancelPlantElectricityAction,
  editCncExpenseAction,
} from "./actions";
import {
  CncExpensesClient,
  type CncExpenseRow,
  type CncVendorOption,
  type PlantElectricityRow,
} from "./expenses-client";

type Search = Promise<{ year?: string; month?: string }>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function istTodayParts(): { year: number; month: number } {
  // IST = UTC + 5:30. Shift then read UTC accessors.
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export default async function CncExpensesPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canEnterCncExpenses(profile)) {
    redirect("/");
  }

  const sp = await searchParams;
  const today = istTodayParts();
  const year = Math.min(2100, Math.max(2020, Number(sp.year) || today.year));
  const month = Math.min(12, Math.max(1, Number(sp.month) || today.month));

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // ── Fetch CNC vendors (alphabetical) ───────────────────────────
  const { data: vendorsRaw } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("vendor_type", "CNC")
    .order("name");
  const vendors: CncVendorOption[] = ((vendorsRaw ?? []) as Array<{
    id: string;
    name: string;
  }>).map((v) => ({ id: v.id, name: v.name }));

  // ── Fetch live expenses for the selected month ─────────────────
  const { data: expensesRaw } = await supabase
    .from("cnc_vendor_expenses")
    .select(
      "id, vendor_id, year, month, category, amount, note, entered_by, entered_at, updated_at, updated_by",
    )
    .eq("year", year)
    .eq("month", month)
    .is("cancelled_at", null)
    .order("entered_at", { ascending: false });

  const expenses: CncExpenseRow[] = ((expensesRaw ?? []) as Array<{
    id: string;
    vendor_id: string;
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
    vendorId: e.vendor_id,
    year: e.year,
    month: e.month,
    category: e.category as CncExpenseRow["category"],
    amount: Number(e.amount ?? 0),
    note: e.note,
    enteredByName: e.entered_by ? profilesMap[e.entered_by] ?? "Unknown" : null,
    enteredAt: e.entered_at,
    updatedAt: e.updated_at,
    updatedByName: e.updated_by ? profilesMap[e.updated_by] ?? "Unknown" : null,
  }));

  // Mig 071 — single-row plant electricity entry for this month
  // (active one only — soft-cancelled rows ignored).
  const { data: peRaw } = await supabase
    .from("cnc_plant_electricity")
    .select(
      "id, year, month, units_kwh, amount, note, entered_by, entered_at, updated_at, updated_by",
    )
    .eq("year", year)
    .eq("month", month)
    .is("cancelled_at", null)
    .maybeSingle();
  const plantElectricity: PlantElectricityRow | null = peRaw
    ? (() => {
        const r = peRaw as {
          id: string;
          year: number;
          month: number;
          units_kwh: number | string | null;
          amount: number | string;
          note: string | null;
          entered_by: string | null;
          entered_at: string;
          updated_at: string;
          updated_by: string | null;
        };
        return {
          id: r.id,
          year: r.year,
          month: r.month,
          unitsKwh: r.units_kwh != null ? Number(r.units_kwh) : null,
          amount: Number(r.amount ?? 0),
          note: r.note,
          enteredByName: r.entered_by
            ? profilesMap[r.entered_by] ?? "Unknown"
            : null,
          enteredAt: r.entered_at,
          updatedAt: r.updated_at,
          updatedByName: r.updated_by
            ? profilesMap[r.updated_by] ?? "Unknown"
            : null,
        };
      })()
    : null;

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  // Prev / next month for the sticky-footer quick-nav.
  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const prevHref = `/carving/expenses?year=${prevMonth.y}&month=${pad2(prevMonth.m)}`;
  const nextHref = `/carving/expenses?year=${nextMonth.y}&month=${pad2(nextMonth.m)}`;

  return (
    <CncExpensesClient
      monthLabel={monthLabel}
      year={year}
      month={month}
      vendors={vendors}
      expenses={expenses}
      plantElectricity={plantElectricity}
      prevHref={prevHref}
      nextHref={nextHref}
      addAction={addCncExpenseAction}
      editAction={editCncExpenseAction}
      cancelAction={cancelCncExpenseAction}
      addPlantElectricityAction={addPlantElectricityAction}
      cancelPlantElectricityAction={cancelPlantElectricityAction}
    />
  );
}
