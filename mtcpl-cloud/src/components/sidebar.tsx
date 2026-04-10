"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/types";

const navItems = [
  { href: "/dashboard",  label: "Dashboard",      icon: "◈", roles: ["owner", "planner", "dispatch", "block_entry", "slab_entry", "worker", "carving_assigner", "vendor"] as AppRole[] },
  { href: "/blocks",     label: "Blocks",          icon: "▣", roles: ["owner", "planner", "block_entry"] as AppRole[] },
  { href: "/slabs",      label: "Slabs",           icon: "▤", roles: ["owner", "planner", "slab_entry"] as AppRole[] },
  { href: "/planning",   label: "Plan Generator",  icon: "⌘", roles: ["owner", "planner"] as AppRole[] },
  { href: "/cutting",    label: "Cutting",         icon: "◌", roles: ["owner", "worker", "planner"] as AppRole[] }
];

export function Sidebar({ role, displayName }: { role: AppRole; displayName?: string }) {
  const pathname = usePathname();
  const visibleItems = navItems.filter(item => item.roles.includes(role));

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <img
          src="/logo-light.png"
          alt="MTCPL"
          className="sidebar-logo"
          onError={e => {
            const el = e.currentTarget as HTMLImageElement;
            el.style.display = "none";
            const fallback = el.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "block";
          }}
        />
        <span className="sidebar-logo-fallback" style={{ display: "none" }}>MTCPL</span>
      </div>

      {/* User info */}
      <div className="sidebar-user">
        <div className="sidebar-user-name">{displayName || "MTCPL User"}</div>
        <div className="sidebar-user-role">{role.replace(/_/g, " ")}</div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {visibleItems.map(item => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${isActive ? " nav-link-active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {isActive && <span className="nav-active-dot" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer logout */}
      <div className="sidebar-footer">
        <form action="/api/auth/signout" method="post">
          <button className="logout-btn" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
