import type { Profile } from "@/lib/types";

/**
 * Inventory module permission gates (Migration 041).
 *
 * Three actors:
 *   • storekeeper — the yard employee. Proposes every movement
 *     (issue / return / receive / writeoff), manages the site list
 *     and the component catalog. Never approves their own work.
 *
 *   • crosscheck (Mafat Purohit) — the audit role. Reviews pending
 *     movements and approves or rejects. Same human handles the
 *     bill verification queue, separate badge for each.
 *
 *   • owner — fallback approver. Sees the same queue as crosscheck
 *     and can approve on their behalf when Mafat is unavailable.
 *
 * Developer is the superuser everywhere, as usual.
 *
 *     storekeeper → proposeMovementAction → pending_approval
 *           │
 *           └─► crosscheck (or owner) → approveMovementAction → approved
 *                   │                                              │
 *                   └─► rejected (storekeeper edits + resubmits)   │
 *                                                                  ▼
 *                                                            counted at
 *                                                            destination
 *
 * Read access is wide: any authenticated profile can view the
 * inventory board, history, and site holdings. Write access is
 * locked tight to the three actors above.
 */

/** Storekeeper duties: propose all stock movements, manage the
 *  catalog, manage sites. The proposer is excluded from the
 *  approver list deliberately — segregation of duties. */
export function canManageInventory(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "storekeeper") return true;
  return false;
}

/** Approval gate: crosscheck (Mafat) + owner. Storekeeper is
 *  deliberately excluded — they can't approve their own movement.
 *  Developer always qualifies as superuser. */
export function canApproveInventoryMovements(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "crosscheck") return true;
  return false;
}

/** Read-only view of the inventory board, per-site holdings, and
 *  history. Open to everyone with an inventory-touching role plus
 *  the audit role. Other roles in the company (cutting, carving)
 *  don't see inventory in their sidebar at all — the department
 *  switcher locks them out — but if they navigate to the URL
 *  directly the page won't 403 them, just won't be in their menu. */
export function canViewInventory(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "storekeeper") return true;
  if (p.role === "crosscheck") return true;
  return false;
}

/** Sites CRUD — full management (add new site, edit, archive).
 *  Same set as canManageInventory: storekeeper does day-to-day,
 *  owner can override. */
export function canManageSites(p: Pick<Profile, "role">): boolean {
  return canManageInventory(p);
}

/** Scaffolding component catalog CRUD. Same set as canManageInventory.
 *  When a new size variant of an existing part lands, the storekeeper
 *  adds it through the catalog screen rather than waiting on dev. */
export function canManageScaffoldingComponents(
  p: Pick<Profile, "role">,
): boolean {
  return canManageInventory(p);
}
