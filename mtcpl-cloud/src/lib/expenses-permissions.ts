import type { Profile } from "@/lib/types";

/**
 * Mig 054 — permission gates for the CNC operational-expense flow
 * and the per-machine asset register (depreciation source data).
 *
 * Three concerns kept separate:
 *
 *   • canEnterCncExpenses — daily/monthly entry of operational
 *     expense line items. The new `cnc_expense_entry` role has
 *     exactly this and nothing else.
 *
 *   • canEditMachineAssetValue — editing a machine's book value,
 *     purchase date, depreciation rate. Sensitive — affects every
 *     month's depreciation calc going forward. Dev/owner only.
 *
 *   • canViewCncCosts — used by the carving report builder when
 *     deciding whether to surface the cost columns at all.
 *     carving_head sees costs for their daily ops; the
 *     cnc_expense_entry role technically can read what they
 *     entered too.
 */

/** Enter / edit / soft-cancel CNC vendor operational expenses. */
export function canEnterCncExpenses(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "cnc_expense_entry") return true;
  return false;
}

/** Edit machine asset value (purchase price, book value, rate).
 *  NOT delegated to cnc_expense_entry — that role is for monthly
 *  operating costs, not the asset register. Dev / owner only. */
export function canEditMachineAssetValue(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  return false;
}

/** Read CNC operational expenses + machine asset values. Used by
 *  the carving report builder + the report page render. */
export function canViewCncCosts(p: Pick<Profile, "role">): boolean {
  if (canEnterCncExpenses(p)) return true;
  if (p.role === "carving_head") return true;
  return false;
}
