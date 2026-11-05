"use server";

// Server action for the sidebar department switcher (Migration 036).
//
// The switcher pill posts a hidden form with `department` = one of
// 'production' | 'finance' | 'inventory'. We:
//   1. validate the role can actually switch (developer + owner — every
//      other role is locked by lockedDepartmentForRole)
//   2. persist profiles.active_department
//   3. hand back the landing href for that department so the sidebar
//      can navigate once (it used to redirect() here AND refresh there)
//
// revalidatePath('/', 'layout') flushes the layout cache so the
// sidebar re-renders with the new filter on the next request.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  allowedDepartmentsForRole,
  canSwitchDepartment,
  departmentLandingFor,
  type Department,
} from "@/lib/departments";

const VALID_DEPTS: ReadonlyArray<Department> = ["production", "finance", "inventory", "invoicing", "register", "maintenance", "salary", "vehicles"];

export type SwitchDepartmentResult =
  | { ok: true; href: string }
  | { ok: false; error: string };

/**
 * Daksh Nov 2026 — this used to redirect() from inside the action and
 * return nothing, and the caller then also ran router.refresh(). Two
 * problems, both of which the floor felt:
 *
 *  • A failed persist was a console.warn and it redirected ANYWAY. You
 *    landed on a Production URL while profiles.active_department still
 *    said finance, so the sidebar stayed on Finance and the next app
 *    open put you back there. "It doesn't change, you are on finance
 *    only" is exactly what that looks like.
 *  • redirect() + router.refresh() fetched the destination twice.
 *
 * Now it reports what happened and hands back where to go; the sidebar
 * navigates once, and a failure is something you can see instead of a
 * spinner that never ends.
 */
export async function setActiveDepartmentAction(
  formData: FormData,
): Promise<SwitchDepartmentResult> {
  const { profile } = await requireAuth();

  // Only multi-dept roles can switch. Single-dept roles (cutting
  // operator, biller, plain accountant, etc.) have nowhere to go.
  if (!canSwitchDepartment(profile.role)) {
    return { ok: false, error: "Your role only has the one department." };
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
    return { ok: false, error: `Your role can't open ${dept}.` };
  }

  const supabase = createAdminSupabaseClient();
  // profiles takes ~238,000 writes on 22 rows (every heartbeat touches
  // last_seen_at), so this row is contended and a write can lose a
  // race. One retry costs nothing and turns most transient failures
  // into a switch that simply works.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase
      .from("profiles")
      .update({ active_department: dept })
      .eq("id", profile.id);
    if (!error) {
      lastError = null;
      break;
    }
    lastError = error.message;
  }

  if (lastError) {
    // Say so. Redirecting anyway is what left the app insisting you
    // were still in Finance with no clue why.
    console.error("[setActiveDepartmentAction] persist failed", lastError);
    return {
      ok: false,
      error: "Couldn't save the department switch — please try again.",
    };
  }

  void logAudit(profile.id, "department_switched", "profile", profile.id, {
    to: dept,
  }).catch(() => {});

  // Force the sidebar (and any per-department gating in the layout) to
  // re-render with the new active_department on the next request. Broad
  // on purpose: every cached route carries the sidebar.
  revalidatePath("/", "layout");

  // Per-person landing: Inventory opens on the CNC tool store for
  // whoever may use it, scaffolding for everyone else.
  return { ok: true, href: departmentLandingFor(dept, profile) };
}
