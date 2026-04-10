export type AppRole =
  | "owner"
  | "planner"
  | "block_entry"
  | "slab_entry"
  | "worker";

export type Stone = "PinkStone" | "WhiteStone";

export type StoneType = "PinkStone" | "WhiteStone";

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  is_active: boolean;
};

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
};
