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
  // Mig 076 round 2 — Daksh: "Manager" (DB enum 'crosscheck')
  // also enters expenses now, on top of their bill / inventory
  // audit duties.
  if (p.role === "crosscheck") return true;
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

// ──────────────────────────────────────────────────────────────────
// Mig 060 — Cutter Costing (parallel surface to CNC Costing)
// ──────────────────────────────────────────────────────────────────

/** Enter / edit / soft-cancel cutter operational expenses
 *  (electricity / manpower / repair_maintenance / other). Same
 *  person who does CNC expense entry handles cutter too — Daksh's
 *  spec — so this mirrors canEnterCncExpenses exactly. */
export function canEnterCutterExpenses(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "cnc_expense_entry") return true;
  // Mig 076 round 2 — mirror canEnterCncExpenses; Manager
  // (crosscheck) enters both sides.
  if (p.role === "crosscheck") return true;
  return false;
}

/** Edit the cutter machines' book value (drives depreciation in
 *  every cost calc). Sensitive — dev / owner only, NOT delegated
 *  to cnc_expense_entry. Matches canEditMachineAssetValue's stance
 *  for CNC. */
export function canEditCutterBookValue(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  return false;
}

/** Read the cutter cost report. Mirror canViewCncCosts —
 *  whoever enters expenses can see the resulting cost-per-CFT,
 *  plus team_head (cutting-side manager, the cutter analogue
 *  of carving_head). */
export function canViewCutterCosts(p: Pick<Profile, "role">): boolean {
  if (canEnterCutterExpenses(p)) return true;
  if (p.role === "team_head") return true;
  return false;
}

/** Read the Various Costing landing — visible to anyone who can
 *  view either sub-report (CNC or cutter). */
export function canViewVariousCosting(p: Pick<Profile, "role">): boolean {
  return canViewCncCosts(p) || canViewCutterCosts(p);
}
