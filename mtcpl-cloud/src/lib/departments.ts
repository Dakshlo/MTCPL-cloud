// ──────────────────────────────────────────────────────────────────
// Department model — Migration 036
// ──────────────────────────────────────────────────────────────────
// MTCPL Cloud splits into three operational departments:
//
//   • Production — the original workshop flow: blocks, slabs, plan
//     generator, cutting, carving, dispatch, challan, slab transfer.
//     This is the default for developer + owner accounts.
//
//   • Finance — the accounts module added in migration 028: bills,
//     payments, audits, vendors.
//
//   • Inventory — placeholder for the v2 inventory module. Ships in
//     v1 as a stub page accessible from the switcher, but with no
//     real functionality yet.
//
// The split is UX-only at the route level (no /production/* prefix —
// the existing routes stay where they are). The sidebar reads the
// caller's `active_department` from their profile, filters its
// entries down to that department, and renders a small switcher row
// at the top for users who can hop between all three (developer +
// owner). Everyone else has their department implicitly locked by
// their role (biller/accountant → Finance, cutting/carving roles →
// Production).
//
// This file is the single source of truth for:
//   • the Department type (used by Profile, system-status, sidebar
//     entry definitions, layout dept checks, etc.)
//   • the route → department mapping used by the layout to decide
//     which dept's maintenance flag to consult
//   • the role → locked-department mapping used by the sidebar to
//     hide the switcher for roles that don't get a choice
// ──────────────────────────────────────────────────────────────────

import type { AppRole } from "@/lib/types";

export type Department = "production" | "finance" | "inventory";

/** Static metadata for the switcher pill row. Order here = order in
 *  the UI. */
export const DEPARTMENTS: ReadonlyArray<{
  id: Department;
  label: string;
  icon: string;
  /** Where the switcher lands the user after they click this pill. */
  landingHref: string;
  /** Short blurb shown as a tooltip on the pill. */
  tooltip: string;
}> = [
  {
    id: "production",
    label: "Production",
    icon: "🏭",
    landingHref: "/dashboard",
    tooltip: "Cutting · Carving · Dispatch — the workshop flow",
  },
  {
    id: "finance",
    label: "Finance",
    icon: "💼",
    landingHref: "/accounts",
    tooltip: "Bills · Payments · Vendor accounts",
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "📦",
    landingHref: "/inventory",
    tooltip: "Stock tracking (coming soon)",
  },
] as const;

const FINANCE_PREFIXES = ["/accounts"] as const;
const INVENTORY_PREFIXES = ["/inventory"] as const;

/**
 * Given a request pathname, return which department owns it. Used by
 * the root layout to pick which maintenance flag to consult for the
 * incoming request. Everything not under /accounts or /inventory
 * defaults to Production — that keeps the existing flat routes
 * working without renaming.
 */
export function departmentForRoute(pathname: string): Department {
  for (const p of FINANCE_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "finance";
  }
  for (const p of INVENTORY_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "inventory";
  }
  return "production";
}

/**
 * Returns the department a given role is locked to, or `null` if the
 * role can switch freely (developer + owner only).
 *
 * Roles map to one department implicitly:
 *   • biller, accountant            → Finance
 *   • developer, owner               → null  (can switch)
 *   • everyone else                  → Production
 */
export function lockedDepartmentForRole(role: AppRole): Department | null {
  switch (role) {
    case "developer":
    case "owner":
      return null;
    case "biller":
    case "accountant":
      return "finance";
    default:
      return "production";
  }
}

/**
 * The effective active department for a given (role, stored
 * preference) pair. Honours the role lock if there is one; otherwise
 * returns the stored preference (defaulting to Production for
 * accounts created before Migration 036).
 */
export function effectiveDepartment(
  role: AppRole,
  stored: Department | null | undefined,
): Department {
  const locked = lockedDepartmentForRole(role);
  if (locked) return locked;
  return stored ?? "production";
}

/** Convenience: can this user see the switcher pills? */
export function canSwitchDepartment(role: AppRole): boolean {
  return lockedDepartmentForRole(role) === null;
}

/**
 * Every department this role is permitted to use. For developer +
 * owner that's all three. For a role that's locked to one department,
 * just that one. Used by the lock screen's quick-jump panel — even a
 * locked role (accountant, biller, cutting_operator) deserves a way
 * back to their own department if they somehow land on a route
 * outside it during a maintenance window.
 */
export function rolePermittedDepartments(role: AppRole): Department[] {
  if (canSwitchDepartment(role)) {
    return ["production", "finance", "inventory"];
  }
  const locked = lockedDepartmentForRole(role);
  return locked ? [locked] : [];
}
