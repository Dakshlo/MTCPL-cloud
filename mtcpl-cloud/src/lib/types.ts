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
  | "worker";

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
