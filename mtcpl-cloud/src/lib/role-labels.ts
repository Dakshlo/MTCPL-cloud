// Canonical role → DISPLAY label (Daksh, Jul 2026).
//
// The DB enum values (profiles.role) stay as-is — several were renamed for
// display only: 'crosscheck' → MANAGER, 'accountant_star' → ACCOUNTANT ★,
// 'cnc_expense_entry' → EXPENSES ENTRY, etc. Anywhere a role is shown to a
// human, use roleLabel() so the raw enum value never leaks (e.g. the Work Diary
// people picker used to show "crosscheck"). Mirror of the sidebar's map, now
// shared so every surface reads the same.

const ROLE_LABELS: Record<string, string> = {
  developer: "DEVELOPER",
  owner: "OWNER",
  team_head: "TEAM HEAD",
  carving_head: "CARVING HEAD",
  block_slab_entry: "BLOCK+SLAB ENTRY",
  slab_entry: "SLAB ENTRY",
  block_entry: "BLOCK ENTRY",
  cutting_operator: "CUTTING OPERATOR",
  dispatch: "DISPATCH",
  carving_assigner: "CARVING",
  vendor: "VENDOR",
  slab_transfer: "SLAB TRANSFER",
  biller: "BILLER",
  accountant: "ACCOUNTANT",
  // Display-only rename (mig 076 r2): DB enum stays 'crosscheck'.
  crosscheck: "MANAGER",
  storekeeper: "STOREKEEPER",
  accountant_star: "ACCOUNTANT ★",
  cnc_expense_entry: "EXPENSES ENTRY",
  senior_incharge: "SENIOR INCHARGE ★",
  tender_manager: "TENDER MANAGER",
};

/** Human display name for a role. Falls back to the enum with underscores
 *  spaced + uppercased so an unmapped new role still reads sensibly. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ").toUpperCase();
}
