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
  | "crosscheck";

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
};

export type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
};

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
};
