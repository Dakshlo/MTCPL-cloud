/**
 * Employees department — Records page (Salary paid · PF · ESI, three sections
 * on one page). Mig 189 + 193 + 194. Reads every paid row (paged).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { loadEmployees, loadPaidRows } from "../_data";
import { RecordsView } from "../salary-client";
import { MigrationBanner } from "../_migration-banner";

export const dynamic = "force-dynamic";

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { employees, needsMigration, needs193 } = await loadEmployees(admin);
  const paidRows = needsMigration ? [] : await loadPaidRows(admin);

  return (
    <section className="page-card">
      <MigrationBanner needsMigration={needsMigration} needs193={needs193} />
      <RecordsView employees={employees} paidRows={paidRows} toast={sp.toast} />
    </section>
  );
}
