/**
 * Employees department — Employees page (the master list). Mig 189 + 193 + 194.
 * Sibling pages: /salary/pay (batches) · /salary/records (paid / PF / ESI).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseSalary } from "@/lib/salary-permissions";
import { loadEmployees, orgOptions, desigOptions } from "./_data";
import { EmployeesView } from "./salary-client";
import { MigrationBanner } from "./_migration-banner";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!canUseSalary(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const { employees, needsMigration, needs193 } = await loadEmployees(admin);

  return (
    <section className="page-card">
      <MigrationBanner needsMigration={needsMigration} needs193={needs193} />
      <EmployeesView
        employees={employees}
        organizations={orgOptions(employees)}
        designations={[...new Set(["Worker", ...desigOptions(employees)])].sort((a, b) => a.localeCompare(b))}
        isBoss={profile.role === "owner" || profile.role === "developer"}
        toast={sp.toast}
      />
    </section>
  );
}
