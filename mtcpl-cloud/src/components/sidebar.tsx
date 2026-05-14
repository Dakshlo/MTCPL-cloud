"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import type { AppRole } from "@/lib/types";
import {
  DEPARTMENTS,
  canSwitchDepartment,
  effectiveDepartment,
  type Department,
} from "@/lib/departments";
import { setActiveDepartmentAction } from "@/app/(app)/department-actions";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  type?: "item";
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
  /** Migration 036 — which department this entry belongs to. Default
   *  is 'production'. Sidebar filters entries down to the user's
   *  current active_department in addition to the existing role
   *  check. */
  department?: Department;
};

type NavDivider = {
  type: "divider";
  label?: string;
  roles: AppRole[];
  /** Same dept tag — divider only renders if at least one ITEM in the
   *  current department is visible below it. */
  department?: Department;
};

type NavEntry = NavItem | NavDivider;

// Migration 036 note: each entry carries a `department`. Entries
// without an explicit tag default to 'production' below. The sidebar
// filters by (role) AND (department === activeDepartment) for users
// who can switch (developer + owner); for everyone else the role
// filter alone is sufficient since their role implicitly limits them.
const navEntries: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "◈",
    roles: ["developer", "owner"],
    department: "production",
  },
  {
    href: "/blocks",
    label: "Blocks",
    icon: "▣",
    roles: ["developer", "owner", "team_head", "block_slab_entry", "block_entry"],
    department: "production",
  },
  {
    href: "/slabs",
    label: "Required Sizes",
    icon: "▤",
    roles: ["developer", "owner", "team_head", "slab_entry", "block_slab_entry"],
    department: "production",
  },
  {
    href: "/slabs/view",
    label: "Plan Generator",
    icon: "⌘",
    roles: ["developer", "owner", "team_head"],
    department: "production",
  },
  // — Section break before workshop / execution items —
  {
    type: "divider",
    label: "WORKSHOP",
    roles: ["developer", "owner", "team_head", "cutting_operator"],
    department: "production",
  },
  {
    href: "/cutting",
    label: "Cutting",
    icon: "✂",
    roles: ["developer", "owner", "cutting_operator", "team_head"],
    department: "production",
  },
  {
    href: "/slabs/ready",
    label: "Total Ready Sizes",
    icon: "✦",
    roles: ["developer", "owner", "team_head", "block_slab_entry", "carving_head"],
    department: "production",
  },
  {
    type: "divider",
    label: "CARVING",
    roles: ["developer", "owner", "vendor", "carving_head"],
    department: "production",
  },
  {
    href: "/slabs/ready/for-carving",
    label: "Ready Sizes Stock",
    icon: "📦",
    roles: ["developer", "owner", "carving_head"],
    department: "production",
  },
  {
    href: "/carving",
    label: "Carving Jobs",
    icon: "🎨",
    roles: ["developer", "owner", "carving_head"],
    department: "production",
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    icon: "🚚",
    roles: ["developer", "owner", "carving_head"],
    department: "production",
  },
  {
    href: "/vendor",
    label: "My Jobs",
    icon: "👤",
    roles: ["developer", "vendor"],
    department: "production",
  },
  {
    href: "/carving/transfer",
    label: "Slab Transfer",
    icon: "🚧",
    roles: ["developer", "slab_transfer"],
    department: "production",
  },
  // ── ACCOUNTS section (Finance department, mig 028 + 037 crosscheck) ──
  {
    type: "divider",
    label: "ACCOUNTS",
    roles: ["developer", "owner", "accountant", "crosscheck"],
    department: "finance",
  },
  {
    // Mig 037: crosscheck role sees the All Bills list as their
    // primary entry point — they review pending bills from here and
    // also from the top-bar Bills Audit badge.
    href: "/accounts/bills",
    label: "All Bills",
    icon: "📑",
    roles: ["developer", "owner", "accountant", "crosscheck"],
    department: "finance",
  },
  {
    // Crosscheck queue — the dedicated audit page that lists every
    // bill at status='pending_approval' waiting for verification.
    // Reusing the existing /accounts/approvals route from mig 028.
    href: "/accounts/approvals",
    label: "Crosscheck Queue",
    icon: "✅",
    roles: ["crosscheck"],
    department: "finance",
  },
  {
    href: "/accounts",
    label: "Due Bills",
    icon: "💰",
    roles: ["developer", "owner", "accountant"],
    department: "finance",
  },
  {
    href: "/accounts/pay-today",
    label: "Pay Today",
    icon: "💸",
    roles: ["accountant"],
    department: "finance",
  },
  {
    href: "/accounts/payments",
    label: "Payment History",
    icon: "🗂️",
    roles: ["developer", "owner", "accountant"],
    department: "finance",
  },
  {
    href: "/accounts/vendors",
    label: "Vendor Account",
    icon: "🏢",
    roles: ["developer", "owner", "accountant"],
    department: "finance",
  },
  // ── INVOICING section (Migration 038 — outgoing customer invoices) ──
  // Locked to developer + owner for v1. Add a dedicated invoicer role
  // later if Daksh wants to delegate the daily generation work.
  {
    type: "divider",
    label: "INVOICING",
    roles: ["developer", "owner"],
    department: "invoicing",
  },
  {
    href: "/invoicing",
    label: "All Invoices",
    icon: "🧾",
    roles: ["developer", "owner"],
    department: "invoicing",
  },
  {
    href: "/invoicing/new",
    label: "New Invoice",
    icon: "✚",
    roles: ["developer", "owner"],
    department: "invoicing",
  },
  // ── INVENTORY section (Migration 041 — Scaffolding v1) ──────────
  // Deliberately minimal: one entry per role. The scaffolding board
  // itself surfaces a horizontal sub-nav (Board / Issue / Return /
  // Receive / Write-off / Audit / History / Sites / Catalog) so the
  // sidebar doesn't need to duplicate those eight rows — that just
  // doubles the navigation surface and clutters the rail.
  //
  // Per Daksh: "if everything is on this page, remove the other
  // scaffolding entries from the menu."
  //
  // Crosscheck (Mafat) gets a direct shortcut to the audit queue,
  // mirroring the /accounts/approvals shortcut he already has on
  // the finance sidebar.
  {
    type: "divider",
    label: "INVENTORY",
    roles: ["developer", "owner", "storekeeper", "crosscheck"],
    department: "inventory",
  },
  {
    href: "/inventory/scaffolding",
    label: "Scaffolding",
    icon: "📦",
    roles: ["developer", "owner", "storekeeper"],
    department: "inventory",
  },
  {
    href: "/inventory/approvals",
    label: "Audit Queue",
    icon: "✅",
    roles: ["crosscheck"],
    department: "inventory",
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
    crosscheck: "CROSSCHECK",
    storekeeper: "STOREKEEPER",
  };
  return labels[role] ?? role.replace(/_/g, " ").toUpperCase();
}

export function Sidebar({
  role,
  displayName,
  themePreference,
  activeDepartment,
}: {
  role: AppRole;
  displayName?: string;
  themePreference?: "light" | "dark" | null;
  /** Migration 036 — the user's current active_department from
   *  profiles. For developer + owner this controls which entries are
   *  shown (filtered to one department at a time); for every other
   *  role this is effectively pinned by their role and the filter is
   *  a no-op. */
  activeDepartment?: Department | null;
}) {
  const pathname = usePathname();
  const [switching, startSwitchTransition] = useTransition();

  const switchable = canSwitchDepartment(role);
  const currentDept = effectiveDepartment(role, activeDepartment ?? null);

  // Step 1: standard role-based filter (unchanged from migration 028).
  let visibleEntries = navEntries.filter((entry) => entry.roles.includes(role));

  // Step 2 (Migration 036): department filter for switchable roles.
  // Locked roles (everyone except dev/owner) keep the full role-filtered
  // set — their role already narrowed them to one department's worth
  // of entries.
  if (switchable) {
    visibleEntries = visibleEntries.filter(
      (entry) => (entry.department ?? "production") === currentDept,
    );
  }

  // ── Name-based overrides ───────────────────────────────────────────
  const upperName = (displayName ?? "").toUpperCase();
  const isNamedTrustedUser = upperName.includes("RAJESH") || upperName.includes("NARESH");
  if (isNamedTrustedUser && !visibleEntries.some((e) => e.type !== "divider" && e.href === "/dashboard")) {
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
    // /slabs/ready owns the main Ready Sizes page; /slabs/ready/for-carving
    // is its sibling sidebar entry. The match needs to be precise so
    // both don't light up at once when the user is on either page.
    if (href === "/slabs/ready") {
      return (
        pathname === "/slabs/ready" ||
        (pathname.startsWith("/slabs/ready/") && !pathname.startsWith("/slabs/ready/for-carving"))
      );
    }
    if (href === "/slabs/ready/for-carving") return pathname.startsWith("/slabs/ready/for-carving");
    // /carving owns the Carving Jobs nav. /carving/floor + /carving/[id]
    // are sub-routes that should NOT light up the parent (Floor View
    // gets its own pill, detail pages don't need either lit).
    if (href === "/carving") return pathname === "/carving";
    if (href === "/carving/floor") return pathname.startsWith("/carving/floor");
    if (href === "/carving/reports") return pathname.startsWith("/carving/reports");
    if (href === "/carving/transfer") return pathname.startsWith("/carving/transfer");
    // /accounts is the Due Bills landing — exact match only so it
    // doesn't light up while the user is on any /accounts/* sub-route
    // (e.g. /accounts/bills, /accounts/payments, etc.). Otherwise the
    // sidebar shows three menu items highlighted at once for any
    // accounts page, which is what Daksh flagged.
    if (href === "/accounts") return pathname === "/accounts";
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

      {/* Department switcher (Migration 036) — developer + owner only.
          A horizontal pill row that lets the user "enter" one of the
          three operational departments. The active pill is highlighted
          and inert; the others post a form to setActiveDepartmentAction,
          which updates profiles.active_department and redirects to the
          department's landing page.

          Pills sit above the user block so the active department is
          the first thing the eye lands on when scanning the sidebar. */}
      {switchable && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 14px 4px",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Department
          </span>
          {/* 2×2 grid — Production / Finance on top row, Invoicing /
              Inventory on bottom row. Was a single horizontal flex
              row which overflowed/scrolled once we hit 4 departments. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 3,
            }}
          >
            {DEPARTMENTS.map((d) => {
              const isActive = d.id === currentDept;
              if (isActive) {
                return (
                  <span
                    key={d.id}
                    title={d.tooltip}
                    style={{
                      textAlign: "center",
                      padding: "6px 4px",
                      fontSize: 11,
                      fontWeight: 700,
                      background: "var(--gold)",
                      color: "#fff",
                      borderRadius: 5,
                      letterSpacing: "0.02em",
                      cursor: "default",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {d.icon} {d.label}
                  </span>
                );
              }
              return (
                <form
                  key={d.id}
                  action={setActiveDepartmentAction}
                  onSubmit={() => {
                    startSwitchTransition(() => {});
                  }}
                  style={{ margin: 0 }}
                >
                  <input type="hidden" name="department" value={d.id} />
                  <button
                    type="submit"
                    title={d.tooltip}
                    disabled={switching}
                    style={{
                      width: "100%",
                      padding: "6px 4px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "transparent",
                      color: "var(--text)",
                      border: "none",
                      borderRadius: 5,
                      cursor: switching ? "wait" : "pointer",
                      opacity: switching ? 0.6 : 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {d.icon} {d.label}
                  </button>
                </form>
              );
            })}
          </div>
        </div>
      )}

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
