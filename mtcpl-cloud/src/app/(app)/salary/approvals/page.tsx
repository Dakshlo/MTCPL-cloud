/**
 * Employees dept — Batch approval panel (mig 198). Owner / developer only.
 * Salary batches are created PENDING; an owner approves here (or inline on the
 * Pay-salary card) to unlock the batch's HDFC bank CSV. Rejecting drops the
 * whole batch.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadPendingApprovalBatches } from "../_data";
import { SalaryApprovalsView } from "../salary-client";

export const dynamic = "force-dynamic";

export default async function SalaryApprovalsPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) redirect("/salary");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const batches = await loadPendingApprovalBatches(admin);

  return (
    <section className="page-card">
      <SalaryApprovalsView batches={batches} toast={sp.toast} />
    </section>
  );
}
