/**
 * Employees department — Pay salary page (monthly batches → HDFC CSV → paid).
 * Mig 189 + 193 + 194. ?month=YYYY-MM picks the working month (default: current
 * IST month).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { loadEmployees, loadMonthRows, loadBatches } from "../_data";
import { PayMonthView } from "../salary-client";
import { MigrationBanner } from "../_migration-banner";

export const dynamic = "force-dynamic";

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

export default async function PaySalaryPage({ searchParams }: { searchParams: Promise<{ month?: string; toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const now = istNow();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthYm = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : fallback;
  const monthKey = `${monthYm}-01`;

  const { employees, needsMigration, needs193: e193 } = await loadEmployees(admin);
  const monthRows = needsMigration ? [] : await loadMonthRows(admin, monthKey, employees);
  const { batches, needs193: b193, needs198 } = needsMigration ? { batches: [], needs193: false, needs198: false } : await loadBatches(admin, monthKey);

  return (
    <section className="page-card">
      <MigrationBanner needsMigration={needsMigration} needs193={e193 || b193} needs198={needs198} />
      <PayMonthView
        employees={employees}
        monthYm={monthYm}
        monthRows={monthRows}
        batches={batches}
        approvalEnabled={!needs198}
        isBoss={profile.role === "owner" || profile.role === "developer"}
        toast={sp.toast}
      />
    </section>
  );
}
