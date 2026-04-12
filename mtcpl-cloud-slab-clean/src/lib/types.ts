export type AppRole = "owner" | "office" | "assigner" | "vendor" | "dispatch";

export type DimensionMode = "ft_inch" | "decimal_ft";

export type SlabStatus =
  | "entered"
  | "ready_for_assignment"
  | "assigned"
  | "in_progress"
  | "completed_pending_approval"
  | "approved_ready_to_ship"
  | "denied_rework"
  | "dispatched";

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  vendor_id: string | null;
  vendor_name?: string | null;
  is_active: boolean;
};

export type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  is_active?: boolean;
};

export type Temple = {
  id: string;
  name: string;
  code_prefix: string;
  is_active: boolean;
  display_order?: number | null;
};

export type SystemSettings = {
  id: true;
  dimension_mode: DimensionMode;
  updated_at?: string;
};

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
};
