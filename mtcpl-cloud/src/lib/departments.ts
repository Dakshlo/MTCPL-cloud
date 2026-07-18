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

export type Department = "production" | "finance" | "inventory" | "invoicing" | "register" | "maintenance" | "salary" | "vehicles";

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
    tooltip: "Incoming bills · Payments · Vendor accounts",
  },
  {
    id: "invoicing",
    label: "Invoicing",
    icon: "🧾",
    landingHref: "/invoicing",
    tooltip: "Outgoing customer invoices — generate, print, archive",
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "📦",
    landingHref: "/inventory/scaffolding",
    tooltip: "Scaffolding · Stock movements · Site holdings",
  },
  {
    // Mig 101 + 102 — standalone Activity Register (proof of demos /
    // samples / activities sent). Owner + developer only for now.
    id: "register",
    label: "Register",
    icon: "📒",
    landingHref: "/activity-register",
    tooltip: "Activity register — dated proof of demos / samples / activities",
  },
  {
    // Mig 108–110 — company machine registry + repair-ticket workflow.
    // Owner + developer only for now.
    id: "maintenance",
    label: "Maintenance",
    icon: "🛠️",
    landingHref: "/maintenance",
    tooltip: "Company machines — working status, repair tickets & approvals",
  },
  {
    // Mig 189/193 — Employees: employee master, monthly salary BATCHES,
    // PF + ESI records + the HDFC bulk-payment sheet (Finance's format).
    // Completely separate tables — owner / developer / ACCOUNTANT★.
    id: "salary",
    label: "Employees",
    icon: "👥",
    landingHref: "/salary",
    tooltip: "Employees · salary batches · PF / ESI records · HDFC bank sheet",
  },
  {
    // Mig 204 — Vehicles: company vehicle document management. EMI monitor,
    // government papers (uploads), insurance / PUC / fitness expiries.
    // Owner + developer only for now.
    id: "vehicles",
    label: "Vehicles",
    icon: "🚚",
    landingHref: "/vehicles",
    tooltip: "Vehicle documents — EMI · insurance · PUC · fitness expiries",
  },
] as const;

const FINANCE_PREFIXES = ["/accounts"] as const;
const INVENTORY_PREFIXES = ["/inventory"] as const;
const INVOICING_PREFIXES = ["/invoicing"] as const;
const REGISTER_PREFIXES = ["/activity-register"] as const;
const MAINTENANCE_PREFIXES = ["/maintenance"] as const;
const SALARY_PREFIXES = ["/salary"] as const;
const VEHICLES_PREFIXES = ["/vehicles"] as const;

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
  for (const p of INVOICING_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "invoicing";
  }
  for (const p of REGISTER_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "register";
  }
  for (const p of MAINTENANCE_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "maintenance";
  }
  for (const p of SALARY_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "salary";
  }
  for (const p of VEHICLES_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return "vehicles";
  }
  return "production";
}

/**
 * Returns the department a given role is locked to, or `null` if the
 * role can switch freely (developer + owner only).
 *
 * Roles map to one department implicitly:
 *   • biller, accountant, crosscheck → Finance
 *   • storekeeper                    → Inventory (mig 041)
 *   • developer, owner               → null  (can switch)
 *   • everyone else                  → Production
 *
 * Note on crosscheck: Mafat Purohit holds this role and audits BOTH
 * the bill queue (his primary work) and the inventory queue (mig 041
 * follow-on). The role still locks to Finance — the Inventory Audit
 * badge surfaces on the top bar from any page, so he's never far
 * from either queue.
 */
/**
 * Departments this role can navigate between.
 *
 * Single-element list = role is "locked" to that department; the
 * sidebar dept switcher doesn't render (no point — only one tile).
 *
 * Multi-element list = switcher renders ONLY those tiles. The
 * developer / owner case returns all 4 (full freedom). The
 * final_auditor (ACCOUNTANT★) case returns just [finance,
 * invoicing] — Daksh's spec: that role works across both surfaces
 * (finance bill audit + invoicing customer party / challan
 * management) but should NOT see Production or Inventory tiles.
 */
export function allowedDepartmentsForRole(role: AppRole): Department[] {
  switch (role) {
    case "developer":
    case "owner":
      return ["production", "finance", "invoicing", "inventory", "register", "maintenance", "salary", "vehicles"];
    // Mig 058 follow-on (Daksh): ACCOUNTANT★ gets a Finance / Invoicing
    // switcher. Mig 189 — Salary/PF added (they run the bank sheet).
    case "accountant_star":
      return ["finance", "invoicing", "salary"];
    // Mig 061 follow-on (Daksh): crosscheck audits both bills
    // (Finance) and inventory movements (mig 041 audit queue), so
    // they get a 2-tile Finance / Inventory switcher. Without it
    // both depts' pages cram into a single sidebar — the switcher
    // gives the same per-room pattern owner / dev / ACCOUNTANT★
    // already use.
    //
    // Mig 076 round 2 — display renamed to MANAGER. Production
    // added so Mafat can enter CNC + Cutter expenses (Daksh's
    // ask). Now a 3-tile Finance / Production / Inventory switcher.
    // June 2026 (Daksh) — Maintenance added: Manager gets the machine
    // board to mark machines Under-maintenance (view-only on the
    // registry; the page hides the Edit-machines controls).
    case "crosscheck":
      return ["finance", "production", "inventory", "maintenance"];
    case "biller":
      return ["finance"];
    // Daksh (June 2026): plain accountant now also works in Invoicing —
    // specifically the standalone Work Order Document generator — so
    // they get a 2-tile Finance / Invoicing switcher. (The invoicing
    // v2 surfaces — parties / challans / invoices — stay gated to
    // accountant_star via canUseInvoicing; accountant only sees the
    // Work Order Doc inside Invoicing.)
    // Jul 2026 (Daksh) — plain accountant also runs the Employees department
    // (salary / PF / ESI), same as accountant★.
    case "accountant":
      return ["finance", "invoicing", "salary"];
    // Mig 195 — Employee-register role: ONLY the Employees department.
    case "employee_register":
      return ["salary"];
    // Mig 054 — cnc_expense_entry is a production-cost role.
    // CNC machines are part of production; their operating
    // expenses (tools, electricity, labor) are tracked here so
    // the carving cost analysis stays in one department.
    case "cnc_expense_entry":
      return ["production"];
    case "storekeeper":
      return ["inventory"];
    // Mig 104 — Tender Manager owns the Register department. Daksh
    // (June 2026) — also given Production access (Temple View + carving
    // assign/approval), so it now gets a 2-tile switcher. Register stays
    // first = its home / default landing.
    case "tender_manager":
      return ["register", "production"];
    // Mig 104 — Register access added for senior_incharge + carving_head,
    // alongside their Production room → they get a 2-tile switcher.
    case "senior_incharge":
    case "carving_head":
      return ["production", "register"];
    default:
      return ["production"];
  }
}

/**
 * Legacy "locked dept" helper. Returns the single dept IFF the
 * role has exactly one allowed dept; null if they can switch.
 * Kept for back-compat — prefer `allowedDepartmentsForRole`
 * going forward.
 */
export function lockedDepartmentForRole(role: AppRole): Department | null {
  const allowed = allowedDepartmentsForRole(role);
  return allowed.length === 1 ? allowed[0] : null;
}

/**
 * The effective active department for a given (role, stored
 * preference) pair.
 *   • If the stored value is one of the role's allowed depts → use it.
 *   • Otherwise → fall back to the first allowed dept (deterministic
 *     default: production for dev/owner, finance for accountant★,
 *     etc.).
 */
export function effectiveDepartment(
  role: AppRole,
  stored: Department | null | undefined,
): Department {
  const allowed = allowedDepartmentsForRole(role);
  if (stored && allowed.includes(stored)) return stored;
  return allowed[0] ?? "production";
}

/** Convenience: can this user see the switcher tiles? True iff
 *  the role has more than one allowed dept. */
export function canSwitchDepartment(role: AppRole): boolean {
  return allowedDepartmentsForRole(role).length > 1;
}

/**
 * Every department this role is permitted to use. Same as
 * allowedDepartmentsForRole — kept as a separate name for
 * back-compat with the lock-screen quick-jump panel.
 */
export function rolePermittedDepartments(role: AppRole): Department[] {
  return allowedDepartmentsForRole(role);
}
