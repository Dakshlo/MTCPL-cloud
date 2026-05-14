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
  // Migration 028 — accounting module roles.
  // biller     fills the bill-entry form (lands on /accounts/bills/new).
  // accountant manages the due-bills dashboard + payments (lands on /accounts).
  | "biller"
  | "accountant";

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
  /** Migration 036 — which "department" the user is currently in.
   *  Only meaningful for developer + owner (the lockedDepartmentForRole
   *  helper enforces the lock for every other role). Defaults to
   *  'production' for existing accounts. See src/lib/departments.ts. */
  active_department?: "production" | "finance" | "inventory" | null;
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
