import Link from "next/link";

import type { AppRole, NavItem } from "@/lib/types";

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["owner", "planner", "dispatch"] },
  { href: "/blocks", label: "Blocks", roles: ["owner", "planner", "block_entry"] },
  { href: "/slabs", label: "Slabs", roles: ["owner", "planner", "slab_entry"] },
  { href: "/planning", label: "Planning", roles: ["owner", "planner"] },
  { href: "/cutting", label: "Cutting", roles: ["owner", "worker"] },
  { href: "/carving-assign", label: "Carving Assign", roles: ["owner", "carving_assigner"] },
  { href: "/carving", label: "Carving", roles: ["owner", "dispatch", "vendor"] },
  { href: "/users", label: "Users", roles: ["owner"] }
];

export function Sidebar({ role, displayName }: { role: AppRole; displayName?: string }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">MC</div>
        <div>
          <strong>{role === "vendor" && displayName ? displayName : "MTCPL Cloud"}</strong>
          <p>{role === "vendor" && displayName ? "Vendor workspace" : "Shared web workflow"}</p>
        </div>
      </div>

      <nav className="nav-stack">
        {navItems
          .filter((item) => item.roles.includes(role))
          .map((item) => (
            <Link className="nav-link" href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
      </nav>
    </aside>
  );
}
