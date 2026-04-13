"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
  children?: { href: string; label: string; roles: AppRole[] }[];
};

const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "◈",
    // Only owner and developer can see Dashboard
    roles: ["developer", "owner"],
  },
  {
    href: "/blocks",
    label: "Blocks",
    icon: "▣",
    roles: ["developer", "owner", "team_head", "block_slab_entry", "block_entry"],
    // slab_entry sees slabs only; block_entry sees blocks only (no report link via nav)
  },
  {
    href: "/slabs",
    label: "Slabs",
    icon: "▤",
    roles: ["developer", "owner", "team_head", "slab_entry", "block_slab_entry"],
    children: [
      {
        href: "/slabs/view",
        label: "View Inventory",
        roles: ["developer", "owner", "team_head"],
      },
    ],
  },
  {
    href: "/planning",
    label: "Plan Generator",
    icon: "⌘",
    roles: ["developer", "owner", "team_head"],
  },
  {
    href: "/cutting",
    label: "Cutting",
    icon: "◌",
    roles: ["developer", "owner", "cutting_operator", "team_head"],
  },
  {
    href: "/slabs/ready",
    label: "Ready Slabs",
    icon: "✦",
    roles: ["developer", "owner", "team_head", "block_slab_entry"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "⚙",
    roles: ["developer", "owner", "team_head"],
  },
];

function roleLabel(role: AppRole): string {
  const labels: Partial<Record<AppRole, string>> = {
    developer: "DEVELOPER",
    owner: "OWNER",
    team_head: "TEAM HEAD",
    block_slab_entry: "BLOCK+SLAB ENTRY",
    slab_entry: "SLAB ENTRY",
    block_entry: "BLOCK ENTRY",
    cutting_operator: "CUTTING OPERATOR",
    dispatch: "DISPATCH",
    carving_assigner: "CARVING",
    vendor: "VENDOR",
  };
  return labels[role] ?? role.replace(/_/g, " ").toUpperCase();
}

export function Sidebar({ role, displayName }: { role: AppRole; displayName?: string }) {
  const pathname = usePathname();
  const visibleItems = navItems.filter(item => item.roles.includes(role));

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    // /slabs/ready is its own top-level nav item — don't let /slabs match it
    if (href === "/slabs") return pathname === "/slabs" || pathname === "/slabs/view";
    return pathname === href || pathname.startsWith(href + "/");
  }

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
            const fb = el.nextElementSibling as HTMLElement | null;
            if (fb) fb.style.display = "block";
          }}
        />
        <span className="sidebar-logo-fallback" style={{ display: "none" }}>MTCPL</span>
      </div>

      {/* User */}
      <div className="sidebar-user">
        <div className="sidebar-user-name">{displayName || "MTCPL User"}</div>
        <div
          className="sidebar-user-role"
          style={role === "team_head" ? { color: "#7eaadc", fontWeight: 700 } : undefined}
        >
          {roleLabel(role)}
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {visibleItems.map(item => {
          const active = isActive(item.href);
          const hasActiveChild = item.children?.some(c => pathname.startsWith(c.href));

          return (
            <div key={item.href} className="nav-group">
              <Link
                href={item.href}
                className={`nav-link${active && !hasActiveChild ? " nav-link-active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {(active && !hasActiveChild) && <span className="nav-active-dot" />}
              </Link>

              {/* Sub-nav children — shown when parent or child is active */}
              {item.children && (active || hasActiveChild) && (
                <div className="nav-children">
                  {item.children
                    .filter(c => c.roles.includes(role))
                    .map(child => {
                      const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`nav-child${childActive ? " nav-child-active" : ""}`}
                        >
                          {child.label}
                          {childActive && <span className="nav-active-dot" style={{ width: 5, height: 5 }} />}
                        </Link>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <form action="/api/auth/signout" method="post">
          <button className="logout-btn" type="submit">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
