// ──────────────────────────────────────────────────────────────────
// Migration 041 — Inventory page shell + sub-nav
// ──────────────────────────────────────────────────────────────────
// Wraps every inventory route in the cream/steel/copper aesthetic
// and renders a horizontal sub-nav of the inventory sections. Sits
// under the global topbar (which still surfaces the Cutting Audit /
// Crosscheck / Pay Today / Inventory Audit badges).
//
// The sub-nav is intentionally NOT in the global sidebar — the
// sidebar already carries the Inventory section for storekeepers,
// but inside the inventory area itself we want a denser local nav
// so the user doesn't have to glance across the screen to navigate
// between Board / Issue / Return / Approvals / History.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { ReactNode } from "react";
import { INV_THEME, inventoryPageWrapper } from "./theme";
import {
  SidebarHideToggle,
  SidebarHideHydrationScript,
} from "./sidebar-hide-toggle";

type SubNavItem = {
  href: string;
  label: string;
  icon: string;
  matchPrefix?: string;
  /** Optional title for hover tooltip; useful where the short
   *  label needs a fuller explanation. */
  title?: string;
};

// Daksh-renamed labels (was Receive / Write-off / Audit Queue /
// Catalog). The underlying movement-type enum values and URLs are
// unchanged — only what the user sees.
// Mig 083 follow-on (Daksh, June 2026) — "Approval List" entry
// now gated on showApprovals; defaults to false so storekeepers
// (who shouldn't approve their own work) don't see it. The
// /inventory/approvals route is still reachable for crosscheck /
// owner via the global sidebar's Audit Queue link.
type ShellRole = "storekeeper" | "crosscheck" | "owner" | "developer" | "other";

const APPROVAL_NAV_ITEM: SubNavItem = {
  href: "/inventory/approvals",
  label: "Approval List",
  icon: "✓",
  title: "Pending movements awaiting crosscheck / owner sign-off",
};

const SUB_NAV_BASE: SubNavItem[] = [
  { href: "/inventory/scaffolding", label: "Board", icon: "▦" },
  { href: "/inventory/scaffolding/issue", label: "Issue", icon: "→", title: "Send stock to a project site" },
  { href: "/inventory/scaffolding/return", label: "Return", icon: "←", title: "Site returns stock to the plant" },
  { href: "/inventory/scaffolding/receive", label: "Buy", icon: "⤓", title: "Buy / receive new stock at the plant" },
  { href: "/inventory/scaffolding/writeoff", label: "Destroyed", icon: "✕", title: "Mark stock as destroyed / damaged / lost" },
  { href: "/inventory/scaffolding/history", label: "History", icon: "⊟" },
  { href: "/inventory/scaffolding/sites", label: "Sites", icon: "⌂" },
  { href: "/inventory/scaffolding/components", label: "Add Component Type", icon: "⊞", title: "Add, edit, or archive scaffolding component types" },
];

export function InventoryShell({
  title,
  subtitle,
  pathname,
  children,
  actions,
  showApprovals = false,
}: {
  title: string;
  subtitle?: string;
  /** Current pathname so we can highlight the active sub-nav item. */
  pathname: string;
  children: ReactNode;
  /** Optional right-aligned action area on the header row. */
  actions?: ReactNode;
  /** Mig 083 — when TRUE the "Approval List" tab is included in
   *  the sub-nav. Pages call this with the result of
   *  canApproveInventoryMovements(profile) so storekeepers don't
   *  see the approval surface (they propose; they don't sign off
   *  on their own work). */
  showApprovals?: boolean;
}) {
  const SUB_NAV: SubNavItem[] = showApprovals
    ? [
        ...SUB_NAV_BASE.slice(0, 5),
        APPROVAL_NAV_ITEM,
        ...SUB_NAV_BASE.slice(5),
      ]
    : SUB_NAV_BASE;
  // Silence eslint-no-unused for the type we exported for callers.
  void ({} as ShellRole);
  return (
    <div className="inv-shell" style={inventoryPageWrapper}>
      {/* Pre-paint hydration script — reads the saved
          "hide sidebar" preference and applies the body class before
          React hydrates so we don't get a flash of "sidebar visible
          then collapses". */}
      <SidebarHideHydrationScript />
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Header — Daksh May 2026 polish pass. Title block on the
            left (steel icon tile + name/subtitle), action group on
            the right with the Hide-menu toggle sitting alongside any
            page-specific actions. The icon tile picked up a subtle
            gradient + soft shadow so it reads as a tab on top of the
            cream paper rather than a flat square. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              aria-hidden="true"
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: `linear-gradient(180deg, ${INV_THEME.steel} 0%, ${INV_THEME.steelDark} 100%)`,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                boxShadow:
                  "0 1px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 16px rgba(28,52,69,0.18)",
              }}
            >
              📦
            </span>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 24,
                  fontWeight: 800,
                  color: INV_THEME.steel,
                  letterSpacing: "0.01em",
                  lineHeight: 1.1,
                }}
              >
                {title}
              </h1>
              {subtitle && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    color: INV_THEME.steelLight,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          {/* Action area: Hide-menu toggle sits FIRST so the page's
              own actions stay on the far right where users expect
              them. A soft divider keeps the two groups visually
              distinct. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <SidebarHideToggle />
            {actions && (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 1,
                    height: 24,
                    background: INV_THEME.parchment,
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>{actions}</div>
              </>
            )}
          </div>
        </div>

        {/* Sub-nav — polished version (Daksh: "make the total bar UI
            good"). Lifted container with a subtle inset highlight,
            each tab carries a soft hover wash, the active tab gets a
            stronger pill + a copper bottom indicator. CSS-only,
            scoped class names so it doesn't leak. */}
        <style>{`
          .inv-subnav-tab {
            position: relative;
            padding: 10px 16px;
            font-size: 12px;
            font-weight: 700;
            text-decoration: none;
            border-radius: 8px;
            color: ${INV_THEME.steel};
            display: inline-flex;
            align-items: center;
            gap: 7px;
            letter-spacing: 0.02em;
            white-space: nowrap;
            transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease;
          }
          .inv-subnav-tab:hover {
            background: ${INV_THEME.cream};
            color: ${INV_THEME.steelDark};
          }
          .inv-subnav-tab .inv-subnav-icon {
            opacity: 0.6;
            font-size: 13px;
            line-height: 1;
            transition: opacity 0.12s ease, transform 0.12s ease;
          }
          .inv-subnav-tab:hover .inv-subnav-icon {
            opacity: 0.95;
          }
          .inv-subnav-tab-active {
            background: linear-gradient(180deg, ${INV_THEME.steel} 0%, ${INV_THEME.steelDark} 100%) !important;
            color: #fff !important;
            box-shadow: 0 1px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
          }
          .inv-subnav-tab-active .inv-subnav-icon {
            opacity: 0.9;
          }
          .inv-subnav-tab-active::after {
            content: "";
            position: absolute;
            left: 14px;
            right: 14px;
            bottom: -1px;
            height: 2px;
            background: ${INV_THEME.copper};
            border-radius: 1px;
          }
          /* Daksh May 2026 — instant tap feedback. On a slow tablet
             connection the navigation takes 1-3s, and without a
             visual cue the user assumes the tap didn't register and
             taps again, which queues a second navigation behind the
             first. The :active pseudo fires the instant the finger
             lands, before any network request, so the tab visibly
             "presses in" and stays pressed until the page swaps. */
          .inv-subnav-tab:active {
            background: ${INV_THEME.steelDark} !important;
            color: #fff !important;
            transform: scale(0.97);
          }
          .inv-subnav-tab:active .inv-subnav-icon {
            opacity: 1 !important;
          }
        `}</style>
        <nav
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 2,
            padding: 5,
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 12,
            boxShadow:
              "0 1px 0 rgba(28, 52, 69, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
          }}
        >
          {SUB_NAV.map((item) => {
            const active =
              item.matchPrefix
                ? pathname.startsWith(item.matchPrefix)
                : pathname === item.href ||
                  (item.href !== "/inventory/scaffolding" &&
                    pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.title ?? item.label}
                /* Daksh May 2026 — prefetch=false on every sub-nav
                 * link. Next.js default prefetches every visible Link
                 * on mount, which on a slow tablet connection fires
                 * 9 background requests + whatever the sidebar's
                 * prefetching, saturating the wifi so the actual
                 * click takes seconds to break through. Sub-nav tabs
                 * are small server-rendered pages that load fast
                 * enough on-demand. */
                prefetch={false}
                className={`inv-subnav-tab${active ? " inv-subnav-tab-active" : ""}`}
              >
                <span className="inv-subnav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Body */}
        <div>{children}</div>
      </div>
    </div>
  );
}
