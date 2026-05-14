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

type SubNavItem = {
  href: string;
  label: string;
  icon: string;
  matchPrefix?: string;
};

const SUB_NAV: SubNavItem[] = [
  { href: "/inventory/scaffolding", label: "Board", icon: "▦" },
  { href: "/inventory/scaffolding/issue", label: "Issue", icon: "→" },
  { href: "/inventory/scaffolding/return", label: "Return", icon: "←" },
  { href: "/inventory/scaffolding/receive", label: "Receive", icon: "⤓" },
  { href: "/inventory/scaffolding/writeoff", label: "Write-off", icon: "✕" },
  { href: "/inventory/approvals", label: "Audit Queue", icon: "✓" },
  { href: "/inventory/scaffolding/history", label: "History", icon: "⊟" },
  { href: "/inventory/scaffolding/sites", label: "Sites", icon: "⌂" },
  { href: "/inventory/scaffolding/components", label: "Catalog", icon: "⊞" },
];

export function InventoryShell({
  title,
  subtitle,
  pathname,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Current pathname so we can highlight the active sub-nav item. */
  pathname: string;
  children: ReactNode;
  /** Optional right-aligned action area on the header row. */
  actions?: ReactNode;
}) {
  return (
    <div style={inventoryPageWrapper}>
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Header */}
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
                width: 44,
                height: 44,
                borderRadius: 10,
                background: INV_THEME.steel,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
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
                }}
              >
                {title}
              </h1>
              {subtitle && (
                <div
                  style={{
                    marginTop: 2,
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
          {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
        </div>

        {/* Sub-nav */}
        <nav
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: 4,
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 10,
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
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                  borderRadius: 6,
                  background: active ? INV_THEME.steel : "transparent",
                  color: active ? "#fff" : INV_THEME.steel,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ opacity: 0.7 }}>{item.icon}</span>
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
