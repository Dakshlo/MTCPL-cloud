export type AppRole =
  | "developer"
  | "owner"
  | "planner"
  | "block_entry"
  | "slab_entry"
  | "block_only"
  | "worker"
  | "carving_assigner"
  | "dispatch"
  | "vendor";

export type StoneType = "PinkStone" | "WhiteStone";

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
};

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
};
