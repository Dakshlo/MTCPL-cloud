"use server";

// Server action for the sidebar department switcher (Migration 036).
//
// The switcher pill posts a hidden form with `department` = one of
// 'production' | 'finance' | 'inventory'. We:
//   1. validate the role can actually switch (developer + owner — every
//      other role is locked by lockedDepartmentForRole)
//   2. persist profiles.active_department
//   3. redirect to the landing href for that department so the user
//      lands on a sensible page in the new context
//
// revalidatePath('/', 'layout') flushes the layout cache so the
// sidebar re-renders with the new filter on the next request.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  DEPARTMENTS,
  allowedDepartmentsForRole,
  canSwitchDepartment,
  type Department,
} from "@/lib/departments";

const VALID_DEPTS: ReadonlyArray<Department> = ["production", "finance", "inventory", "invoicing", "register", "maintenance", "salary"];

export async function setActiveDepartmentAction(formData: FormData) {
  const { profile } = await requireAuth();

  // Only multi-dept roles can switch. Single-dept roles (cutting
  // operator, biller, plain accountant, etc.) get redirected to
  // their landing — no-op.
  if (!canSwitchDepartment(profile.role)) {
    redirect("/dashboard");
  }

  const raw = String(formData.get("department") || "").trim();
  const dept = (VALID_DEPTS as readonly string[]).includes(raw)
    ? (raw as Department)
    : "production";

  // Mig 058 follow-on (Daksh): even multi-dept roles have a
  // restricted set (ACCOUNTANT★ can only switch between Finance
  // and Invoicing — never to Production or Inventory). Defensive
  // check so a hand-crafted POST can't escape the role's scope.
  const allowed = allowedDepartmentsForRole(profile.role);
  if (!allowed.includes(dept)) {
    redirect("/dashboard");
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active_department: dept })
    .eq("id", profile.id);

  // Don't crash the redirect on a transient DB hiccup — the
  // user-facing damage is small (they'll switch back via the pill).
  if (error) {
    console.warn("[setActiveDepartmentAction] persist failed", error.message);
  } else {
    void logAudit(profile.id, "department_switched", "profile", profile.id, {
      to: dept,
    }).catch(() => {});
  }

  // Force the sidebar (and any per-department gating in the layout)
  // to re-render with the new active_department on the next request.
  revalidatePath("/", "layout");

  const landing =
    DEPARTMENTS.find((d) => d.id === dept)?.landingHref ?? "/dashboard";
  redirect(landing);
}
