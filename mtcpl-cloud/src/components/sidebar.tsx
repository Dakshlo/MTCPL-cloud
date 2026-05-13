"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/types";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  type?: "item";
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
};

type NavDivider = {
  type: "divider";
  label?: string;
  roles: AppRole[];
};

type NavEntry = NavItem | NavDivider;

const navEntries: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "◈",
    roles: ["developer", "owner"],
  },
  {
    href: "/blocks",
    label: "Blocks",
    icon: "▣",
    roles: ["developer", "owner", "team_head", "block_slab_entry", "block_entry"],
  },
  {
    href: "/slabs",
    label: "Required Sizes",
    icon: "▤",
    roles: ["developer", "owner", "team_head", "slab_entry", "block_slab_entry"],
  },
  {
    href: "/slabs/view",
    label: "Plan Generator",
    icon: "⌘",
    roles: ["developer", "owner", "team_head"],
  },
  // — Section break before workshop / execution items —
  {
    type: "divider",
    label: "WORKSHOP",
    roles: ["developer", "owner", "team_head", "cutting_operator"],
  },
  {
    href: "/cutting",
    label: "Cutting",
    icon: "✂",
    roles: ["developer", "owner", "cutting_operator", "team_head"],
  },
  {
    href: "/slabs/ready",
    label: "Ready Sizes",
    icon: "✦",
    roles: ["developer", "owner", "team_head", "block_slab_entry", "carving_head"],
  },
  // — Phase 2 carving module. Carving Jobs visible to owner +
  //   the new carving_head role (whose entire job is the carving
  //   pipeline → dispatch). Dispatch shared with carving_head too
  //   so they can hand finished pieces off without bouncing to
  //   the owner. —
  {
    type: "divider",
    label: "CARVING",
    roles: ["developer", "owner", "vendor", "carving_head"],
  },
  {
    href: "/carving",
    label: "Carving Jobs",
    icon: "🎨",
    roles: ["developer", "owner", "carving_head"],
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    icon: "🚚",
    roles: ["developer", "owner", "carving_head"],
  },
  {
    href: "/challan",
    label: "Challan",
    icon: "📋",
    roles: ["developer", "owner"],
  },
  {
    href: "/vendor",
    label: "My Jobs",
    icon: "👤",
    roles: ["developer", "vendor"],
  },
  {
    // Migration 025 — slab transfer dispatch list. Placed UNDER
    // My Jobs in the sidebar at user's request — feels like a
    // sibling of the vendor's own workstation rather than tucked
    // up with the dispatcher's tools. slab_transfer role lands
    // here on login. carving_head + owner + dev see it for oversight.
    href: "/carving/transfer",
    label: "Slab Transfer",
    icon: "🚧",
    roles: ["developer", "owner", "carving_head", "slab_transfer"],
  },
  // ── ACCOUNTS section (migration 028) ────────────────────────────
  // The new accounting / finance vertical. Roles: biller (data entry),
  // accountant (dashboard + payments), owner + developer everywhere.
  {
    type: "divider",
    label: "ACCOUNTS",
    roles: ["developer", "owner", "biller", "accountant"],
  },
  {
    href: "/accounts/bills/new",
    label: "Enter Bill",
    icon: "🧾",
    roles: ["developer", "owner", "biller"],
  },
  {
    href: "/accounts/bills",
    label: "All Bills",
    icon: "📑",
    roles: ["developer", "owner", "biller", "accountant"],
  },
  {
    href: "/accounts/approvals",
    label: "Bills Audit",
    icon: "✅",
    roles: ["developer", "owner"],
  },
  {
    href: "/accounts",
    label: "Due Bills",
    icon: "💰",
    roles: ["developer", "owner", "accountant"],
  },
  {
    href: "/accounts/pay-today",
    label: "Pay Today",
    icon: "💸",
    roles: ["developer", "owner", "accountant"],
  },
  {
    href: "/accounts/payments",
    label: "Payment History",
    icon: "🗂️",
    roles: ["developer", "owner", "accountant"],
  },
  {
    href: "/accounts/vendors",
    label: "Bill Vendors",
    icon: "🏢",
    roles: ["developer", "owner", "accountant"],
  },
];

function roleLabel(role: AppRole): string {
  const labels: Partial<Record<AppRole, string>> = {
    developer: "DEVELOPER",
    owner: "OWNER",
    team_head: "TEAM HEAD",
    carving_head: "CARVING HEAD",
    block_slab_entry: "BLOCK+SLAB ENTRY",
    slab_entry: "SLAB ENTRY",
    block_entry: "BLOCK ENTRY",
    cutting_operator: "CUTTING OPERATOR",
    dispatch: "DISPATCH",
    carving_assigner: "CARVING",
    vendor: "VENDOR",
    slab_transfer: "SLAB TRANSFER",
    biller: "BILLER",
    accountant: "ACCOUNTANT",
  };
  return labels[role] ?? role.replace(/_/g, " ").toUpperCase();
}

export function Sidebar({
  role,
  displayName,
  themePreference,
}: {
  role: AppRole;
  displayName?: string;
  /** User's saved theme preference (from profiles.theme_preference).
   * Passed down to ThemeToggle so it can reconcile cross-device:
   * login on a new browser → localStorage empty → DB value wins. */
  themePreference?: "light" | "dark" | null;
}) {
  const pathname = usePathname();

  // Standard role-based filter.
  let visibleEntries = navEntries.filter((entry) => entry.roles.includes(role));

  // ── Name-based overrides ───────────────────────────────────────────
  // Specific named users get extra nav entries even if their stored
  // role wouldn't normally show them. Rajesh is a team_head in the
  // database but should still see Dashboard (where his stripped
  // Block-Journey-only variant is rendered). Match policy mirrors
  // canTransferPlannedSlabs in src/lib/cutting-permissions.ts —
  // substring match on UPPERCASED full name.
  const upperName = (displayName ?? "").toUpperCase();
  const isNamedTrustedUser = upperName.includes("RAJESH") || upperName.includes("NARESH");
  if (isNamedTrustedUser && !visibleEntries.some((e) => e.type !== "divider" && e.href === "/dashboard")) {
    // Inject Dashboard at the very top of the nav (matches the order
    // owners + developers see).
    const dashboardEntry = navEntries.find(
      (e) => e.type !== "divider" && (e as NavItem).href === "/dashboard",
    );
    if (dashboardEntry) {
      visibleEntries = [dashboardEntry, ...visibleEntries];
    }
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    // /slabs/view (Plan Generator) owns /slabs/view and /planning
    if (href === "/slabs/view")
      return pathname.startsWith("/slabs/view") || pathname.startsWith("/planning");
    // /slabs only matches the slabs list page itself, not sub-pages with their own nav items
    if (href === "/slabs") return pathname === "/slabs";
    // /slabs/ready is its own top-level item
    if (href === "/slabs/ready") return pathname.startsWith("/slabs/ready");
    // /carving owns the Carving Jobs nav. /carving/floor + /carving/[id]
    // are sub-routes that should NOT light up the parent (Floor View
    // gets its own pill, detail pages don't need either lit).
    if (href === "/carving") return pathname === "/carving";
    if (href === "/carving/floor") return pathname.startsWith("/carving/floor");
    if (href === "/carving/reports") return pathname.startsWith("/carving/reports");
    if (href === "/carving/transfer") return pathname.startsWith("/carving/transfer");
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
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            el.style.display = "none";
            const fb = el.nextElementSibling as HTMLElement | null;
            if (fb) fb.style.display = "block";
          }}
        />
        <span className="sidebar-logo-fallback" style={{ display: "none" }}>
          MTCPL
        </span>
      </div>

      {/* User */}
      <div className="sidebar-user">
        <div className="sidebar-user-name">{displayName || "MTCPL User"}</div>
        <div
          className="sidebar-user-role"
          style={
            role === "team_head" ? { color: "#7eaadc", fontWeight: 700 } : undefined
          }
        >
          {roleLabel(role)}
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {visibleEntries.map((entry, i) => {
          if (entry.type === "divider") {
            return (
              <div key={`divider-${i}`} className="nav-divider">
                {entry.label && (
                  <span className="nav-divider-label">{entry.label}</span>
                )}
              </div>
            );
          }

          const item = entry as NavItem;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${active ? " nav-link-active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {active && <span className="nav-active-dot" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <ThemeToggle initialFromDB={themePreference ?? null} />
        <form action="/api/auth/signout" method="post">
          <button className="logout-btn" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
