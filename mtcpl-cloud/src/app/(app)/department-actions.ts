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
  canSwitchDepartment,
  type Department,
} from "@/lib/departments";

const VALID_DEPTS: ReadonlyArray<Department> = ["production", "finance", "inventory", "invoicing"];

export async function setActiveDepartmentAction(formData: FormData) {
  const { profile } = await requireAuth();

  // Only developer + owner can switch. Every other role is locked to a
  // specific department by their role, so an attempt to switch from
  // them is a no-op redirect back to their own landing.
  if (!canSwitchDepartment(profile.role)) {
    redirect("/dashboard");
  }

  const raw = String(formData.get("department") || "").trim();
  const dept = (VALID_DEPTS as readonly string[]).includes(raw)
    ? (raw as Department)
    : "production";

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
