export type AppRole =
  | "developer"
  | "owner"
  | "team_head"
  | "carving_head"
  | "block_slab_entry"
  | "slab_entry"
  | "block_entry"
  | "cutting_operator"
  | "carving_assigner"
  | "dispatch"
  | "vendor"
  | "slab_transfer"
  | "worker"
  // Migration 028 — original accounting roles.
  //
  // biller — deprecated as of migration 037. Kept in the enum so any
  //   pre-existing biller-role profiles continue to function, but
  //   removed from the Settings role picker so admins can't mint
  //   new ones. The accountant role now does bill entry + payments.
  //
  // accountant — does it all in Finance: adds bills, proposes
  //   payments, marks them paid. Lands on /accounts.
  //
  // Migration 037 — new role.
  //
  // crosscheck — verification gate between accountant submit and
  //   "outstanding". Only permission is to flip a bill from
  //   pending_approval → approved. Owner can still approve as a
  //   fallback.
  | "biller"
  | "accountant"
  | "crosscheck"
  // Migration 041 — Inventory module (Scaffolding v1).
  //
  // storekeeper — the yard employee who manages physical stock.
  //   Proposes every movement (issue / return / receive / writeoff).
  //   Locked to the Inventory department. Crosscheck (Mafat) +
  //   owner approve their submissions; the storekeeper cannot
  //   approve their own work (segregation of duties).
  | "storekeeper"
  // tv — wall-display kiosk role: carving floor TV view only, no chrome.
  | "tv"
  // Migration 053 — Finance final audit role.
  //
  // final_auditor — after a payment is marked paid, this role
  //   cross-checks the UTR/reference recorded in MTCPL against the
  //   actual bank statement. Two outcomes per row: verified (all
  //   good) or flagged (reason captured for owner's attention). The
  //   role has full accountant powers and also acts as owner backup
  //   for confirming proposed payments + approving submitted bills
  //   when dad isn't available.
  | "accountant_star"
  // Migration 054 — CNC operational expense entry.
  //
  // cnc_expense_entry — single-page portal at /carving/expenses.
  //   Adds / edits / cancels operational expense line items per
  //   CNC vendor per month (tools, electricity, labor, office,
  //   maintenance, other). No other surface in the app is visible.
  //   Data flows automatically into the carving monthly report's
  //   cost-per-CFT analysis.
  | "cnc_expense_entry"
  // Migration 076 — senior_incharge.
  //
  // senior_incharge — superset of team_head (Rajesh Kumar's profile).
  //   Adds Carving Jobs assign + approve ("Carving Done Approval"
  //   sign-off), Ready Sizes Stock assign, External cut-slab entry,
  //   read-only Global My Jobs (sees every vendor cockpit; can't
  //   load / hold / complete). Cutting + Blocks + Settings
  //   permissions stay identical to team_head.
  | "senior_incharge"
  // Migration 104 — Tender Manager. Owns the Register department
  // (Activity Register): create sites + log/manage activity entries.
  // Register access also granted to senior_incharge + carving_head.
  | "tender_manager";

export type StoneType = "PinkStone" | "WhiteStone";

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  vendor_id: string | null;
  vendor_name?: string | null;
  is_active: boolean;
  /** User's saved theme preference. NULL = never toggled (treat as 'light'). */
  theme_preference?: "light" | "dark" | null;
  /** Migration 027 — per-profile approver flag for the cutting
   *  Cutting-Done → Done-Today supervisor checkpoint. Set to TRUE
   *  on the Rajesh Kumar row post-migration. Developer + Owner
   *  roles qualify regardless of this bit (the canApproveCuts
   *  helper enforces that). */
  can_approve_cuts?: boolean;
  /** Migration 028 — per-profile approver flag for the bill audit
   *  flow (biller submits → owner approves → accountant pays). Set
   *  to TRUE on Naresh's row post-migration. Developer + Owner
   *  always qualify in code regardless of the bit (the
   *  canApproveBills helper enforces that). */
  can_approve_bills?: boolean;
  /** Migration 036 (+ 038 added 'invoicing') — which "department" the
   *  user is currently in. Only meaningful for developer + owner (the
   *  lockedDepartmentForRole helper enforces the lock for every other
   *  role). Defaults to 'production' for existing accounts. See
   *  src/lib/departments.ts. */
  active_department?: "production" | "finance" | "inventory" | "invoicing" | null;
  /** Migration 074 — carving-head-lite flag. When TRUE, the user can
   *  access /carving (Unassigned + Active + Carving Done, but NOT
   *  Awaiting Review) and /slabs (Required Sizes) in addition to
   *  whatever their role allows. Typically set on a vendor profile
   *  so they can assign work to themselves (e.g. Mohit, who runs his
   *  own CNCs AND assigns the carving). */
  can_assign_carving?: boolean;
  /** Mig 077 — extra vendor IDs this user can act as on /vendor.
   *  Daksh: while Alkesh is unavailable, Mohit's row carries
   *  [alkesh-uuid] so the cockpit + the action ownership checks
   *  treat Mohit as Alkesh too. Empty array (default) means no
   *  change in behaviour. Set via Settings UI by owner/developer. */
  managed_vendor_ids?: string[];
  /** Mig 113 — per-user idle auto-logout timeout, in minutes
   *  (developer-set in Settings). NULL/undefined → use the default
   *  (10 min). 0 → never auto-logout for this user. N → log out after
   *  N minutes of inactivity. Developer accounts are always exempt in
   *  the app layer regardless of this value. */
  idle_logout_minutes?: number | null;
};

export type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Outsource";
};

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
};
