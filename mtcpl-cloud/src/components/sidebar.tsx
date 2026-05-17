"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/types";
import {
  DEPARTMENTS,
  canSwitchDepartment,
  effectiveDepartment,
  type Department,
} from "@/lib/departments";
import { setActiveDepartmentAction } from "@/app/(app)/department-actions";
import { ThemeToggle } from "./theme-toggle";
import { FinanceLoadingOverlay } from "./finance-loading-overlay";

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

/** Mig 054 follow-on (Daksh) — collapsible group of nav items.
 *
 *  Daksh: "for developer, in production the My Jobs / Slab Transfer
 *  / CNC Expenses pages are functionally important but not directly
 *  used — fold them into a single sidebar entry that expands to
 *  show the three options. Like the topbar's Tasks / Find ID
 *  pattern."
 *
 *  Render behaviour:
 *    • 0 visible children for current role → group skipped entirely
 *    • 1 visible child  → renders as a flat NavItem (no group wrapper)
 *    • 2+ visible children → renders as collapsible group; auto-
 *      expands when the current pathname matches any child. */
type NavGroup = {
  type: "group";
  label: string;
  icon: string;
  /** Union of all children's roles — sidebar uses this for the
   *  same role-include filter as flat items. */
  roles: AppRole[];
  department?: Department;
  children: NavItem[];
};

type NavEntry = NavItem | NavDivider | NavGroup;

// Mig 044 follow-on — per-department accent colour for the
// department switcher tiles in the sidebar. Each tile wears its
// accent as a top border (and on hover as a soft background wash),
// so the four rooms feel distinct at a glance.
const DEPT_ACCENTS: Record<Department, string> = {
  production: "#c9a14a",  // MTCPL gold — matches the brand
  finance:    "#5e8c4e",  // emerald — money
  invoicing:  "#7a8db8",  // slate-blue — paper / outgoing
  inventory:  "#c87850",  // copper — matches inventory module theme
};

/** Convert "#rrggbb" → "rgba(r,g,b,a)" so we can mix tile accents
 *  with the dark sidebar without committing to a separate CSS file.
 *  Falls back to the input string if it's not a 6-digit hex (lets
 *  rgba() / named colours pass through untouched). */
function hexToAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
    // Total Ready Sizes — cutting-side verification view ("what we cut,
    // what came out of which block"). Daksh asked to drop it from the
    // carving_head sidebar because Parth already has "Ready Sizes Stock"
    // (the actionable bucket view) and seeing both was redundant /
    // confusing for the carving role.
    href: "/slabs/ready",
    label: "Total Ready Sizes",
    icon: "✦",
    roles: ["developer", "owner", "team_head", "block_slab_entry"],
    department: "production",
  },
  {
    type: "divider",
    label: "CARVING",
    // Mig 054 — cnc_expense_entry sees the CARVING section header
    // so its single nav item ("CNC Expenses") renders under the
    // right banner. No other carving entries are visible to that
    // role (they're each role-gated independently).
    roles: ["developer", "owner", "vendor", "carving_head", "cnc_expense_entry"],
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
    // Mig 054 follow-on (Daksh): consolidate three "specialist-role"
    // pages into one collapsible group for users (mainly developer
    // + owner) who can see all of them. Single-role users for whom
    // only ONE child resolves see it as a flat link automatically
    // (the renderer's 1-visible-child path).
    type: "group",
    label: "More",
    icon: "⋯",
    department: "production",
    roles: ["developer", "owner", "vendor", "slab_transfer", "carving_head", "cnc_expense_entry"],
    children: [
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
      {
        href: "/carving/expenses",
        label: "CNC Expenses",
        icon: "💸",
        roles: ["developer", "owner", "carving_head", "cnc_expense_entry"],
        department: "production",
      },
    ],
  },
  // ── ACCOUNTS section (Finance department, mig 028 + 037 crosscheck) ──
  {
    type: "divider",
    label: "ACCOUNTS",
    roles: ["developer", "owner", "accountant", "crosscheck", "final_auditor"],
    department: "finance",
  },
  {
    // Mig 037: crosscheck role sees the All Bills list as their
    // primary entry point — they review pending bills from here and
    // also from the top-bar Bills Audit badge.
    href: "/accounts/bills",
    label: "All Bills",
    icon: "📑",
    roles: ["developer", "owner", "accountant", "crosscheck", "final_auditor"],
    department: "finance",
  },
  {
    // Crosscheck queue — the dedicated audit page that lists every
    // bill at status='pending_approval' waiting for verification.
    // Reusing the existing /accounts/approvals route from mig 028.
    // Mig 053: final_auditor sees the queue too (owner backup for
    // bill approval).
    href: "/accounts/approvals",
    label: "Crosscheck Queue",
    icon: "✅",
    roles: ["crosscheck", "final_auditor"],
    department: "finance",
  },
  {
    href: "/accounts",
    label: "Due Bills",
    icon: "💰",
    roles: ["developer", "owner", "accountant", "final_auditor"],
    department: "finance",
  },
  {
    href: "/accounts/pay-today",
    label: "Pay Today",
    icon: "💸",
    roles: ["accountant", "final_auditor"],
    department: "finance",
  },
  {
    href: "/accounts/payments",
    label: "Payment History",
    icon: "🗂️",
    roles: ["developer", "owner", "accountant", "final_auditor"],
    department: "finance",
  },
  {
    href: "/accounts/vendors",
    label: "Vendor Account",
    icon: "🏢",
    roles: ["developer", "owner", "accountant", "final_auditor"],
    department: "finance",
  },
  {
    // Mig 053 — Final Audit queue. UTR cross-check against bank
    // statement. Final auditor's primary page; owner sees it for
    // visibility into flagged payments.
    //
    // Daksh placed this LAST in the Accounts section because it's
    // the post-payment step — Bills → Due → Pay Today → Payment
    // History → Vendor Account → Final Audit reads as the natural
    // lifecycle order in the sidebar.
    href: "/accounts/final-audit",
    label: "Final Audit",
    icon: "🧾",
    roles: ["developer", "owner", "final_auditor"],
    department: "finance",
  },
  // ── INVOICING section (Mig 038 → Mig 058 — party → challan →
  // invoice restructure). Widened from dev/owner-only to also
  // include final_auditor (the starred accountant — Govind today).
  {
    type: "divider",
    label: "INVOICING",
    roles: ["developer", "owner", "final_auditor"],
    department: "invoicing",
  },
  {
    href: "/invoicing",
    label: "Dashboard",
    icon: "📊",
    roles: ["developer", "owner", "final_auditor"],
    department: "invoicing",
  },
  {
    href: "/invoicing/parties",
    label: "Parties",
    icon: "👤",
    roles: ["developer", "owner", "final_auditor"],
    department: "invoicing",
  },
  {
    href: "/invoicing/challans",
    label: "Challans",
    icon: "📋",
    roles: ["developer", "owner", "final_auditor"],
    department: "invoicing",
  },
  {
    href: "/invoicing/invoices",
    label: "Invoices",
    icon: "🧾",
    roles: ["developer", "owner", "final_auditor"],
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
    // Mig 058 — Daksh: "change to accountant with star — we have
    // 2 accountants and don't want to bias one as senior." Display
    // label only; DB enum stays `final_auditor`.
    final_auditor: "ACCOUNTANT ★",
    cnc_expense_entry: "CNC EXPENSE ENTRY",
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
  const router = useRouter();
  // Daksh (Mig 058 follow-on): dept switch needs two layers of
  // feedback —
  //   1. The FinanceLoadingOverlay (spinning company logo).
  //   2. A thin gold progress bar pinned to the very top of the
  //      viewport (independent of the existing NavigationProgress —
  //      that one only fires for <a> / <form> events; ours fires
  //      from a plain button click).
  // Both stay visible until we detect the activeDepartment prop has
  // actually changed (server action + router.refresh + RSC
  // reconciliation all completed). Safety net: 12s hard timeout so
  // we never hang forever if something goes wrong server-side.
  const [switching, setSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<Department | null>(null);
  const prevActiveDeptRef = useRef<Department | null>(activeDepartment ?? null);

  // Detect activeDepartment prop change — fires once the new
  // sidebar HTML lands. Drop the overlay + bar at that moment.
  useEffect(() => {
    const incoming = activeDepartment ?? null;
    if (switching && prevActiveDeptRef.current !== incoming) {
      setSwitching(false);
      setSwitchingTo(null);
    }
    prevActiveDeptRef.current = incoming;
  }, [activeDepartment, switching]);

  async function handleSwitchDepartment(dept: Department) {
    if (switching) return;
    setSwitching(true);
    setSwitchingTo(dept);

    // 12s safety net — if for any reason the activeDepartment prop
    // never changes (server action errored silently, network
    // hung, etc.), still drop the overlay so the UI isn't stuck.
    const safetyTimer = setTimeout(() => {
      setSwitching(false);
      setSwitchingTo(null);
    }, 12_000);

    try {
      const fd = new FormData();
      fd.set("department", dept);
      await setActiveDepartmentAction(fd);
      router.refresh();
      // Don't drop `switching` here — the useEffect above watches
      // for the activeDepartment prop change and drops it then,
      // so the overlay covers the full visible-transition window
      // (not just the action's promise resolution).
    } catch (err) {
      // On error, drop immediately + clear safety timer.
      clearTimeout(safetyTimer);
      setSwitching(false);
      setSwitchingTo(null);
      console.error("[sidebar] dept switch failed", err);
    }
  }

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
  if (isNamedTrustedUser && !visibleEntries.some((e) => e.type !== "divider" && e.type !== "group" && (e as NavItem).href === "/dashboard")) {
    const dashboardEntry = navEntries.find(
      (e) => e.type !== "divider" && e.type !== "group" && (e as NavItem).href === "/dashboard",
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
    // Mig 054 — /carving/expenses lit only when actually on that page.
    if (href === "/carving/expenses") return pathname.startsWith("/carving/expenses");
    // /accounts is the Due Bills landing — exact match only so it
    // doesn't light up while the user is on any /accounts/* sub-route
    // (e.g. /accounts/bills, /accounts/payments, etc.). Otherwise the
    // sidebar shows three menu items highlighted at once for any
    // accounts page, which is what Daksh flagged.
    if (href === "/accounts") return pathname === "/accounts";
    // Mig 058 — /invoicing is the dashboard; /invoicing/parties,
    // /invoicing/challans, /invoicing/invoices are siblings. Exact
    // match keeps the dashboard chip from lighting up alongside
    // whichever sub-route the user is on.
    if (href === "/invoicing") return pathname === "/invoicing";
    if (href === "/invoicing/invoices")
      return pathname === "/invoicing/invoices" || pathname.startsWith("/invoicing/invoices/");
    if (href === "/invoicing/challans")
      return pathname === "/invoicing/challans" || pathname.startsWith("/invoicing/challans/");
    if (href === "/invoicing/parties")
      return pathname === "/invoicing/parties" || pathname.startsWith("/invoicing/parties/");
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

      {/* Department switcher (Migration 036; refreshed in Mig 044
          follow-on per Daksh — original tiles read odd against the
          dark sidebar, plain text floating on white).
          Redesign:
            • Container blends with the sidebar (dark inset panel
              with a subtle gold inner ring) instead of the bright
              white surface card.
            • Each tile is a stacked icon-over-label target with a
              per-department accent colour so the four feel like
              distinct rooms, not four button-shaped strings.
            • Active tile carries the gold gradient + a small
              indicator pip; inactive tiles wear their department's
              accent at low opacity on a dark base.
          Sits above the user block so the active department is
          the first thing the eye lands on when scanning. */}
      {switchable && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "12px 14px 8px",
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              paddingLeft: 2,
            }}
          >
            Department
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.18) 100%)",
              border: "1px solid rgba(201, 161, 74, 0.18)",
              borderRadius: 10,
              padding: 6,
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.28)",
            }}
          >
            {DEPARTMENTS.map((d) => {
              const isActive = d.id === currentDept;
              const accent = DEPT_ACCENTS[d.id] ?? DEPT_ACCENTS.production;

              // Active tile — solid gold gradient + indicator pip.
              if (isActive) {
                return (
                  <span
                    key={d.id}
                    title={d.tooltip}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "10px 6px 8px",
                      borderRadius: 7,
                      background:
                        "linear-gradient(135deg, #d4b056 0%, #c9a14a 55%, #a4823a 100%)",
                      color: "#fff",
                      cursor: "default",
                      boxShadow:
                        "0 2px 0 rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.18) inset",
                      letterSpacing: "0.02em",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 5,
                        right: 6,
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#fff",
                        boxShadow: "0 0 0 2px rgba(255,255,255,0.35)",
                      }}
                    />
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{d.icon}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {d.label}
                    </span>
                  </span>
                );
              }

              // Inactive tile — dark base with the dept accent
              // creeping in via a top border + hover background tint.
              return (
                <div key={d.id} style={{ margin: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleSwitchDepartment(d.id)}
                    title={d.tooltip}
                    disabled={switching}
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "10px 6px 8px",
                      borderRadius: 7,
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.08) 100%)",
                      color: "rgba(255,255,255,0.78)",
                      border: `1px solid rgba(255,255,255,0.08)`,
                      borderTop: `2px solid ${accent}`,
                      cursor: switching ? "wait" : "pointer",
                      opacity: switching ? 0.55 : 1,
                      transition:
                        "background 0.12s ease, color 0.12s ease, transform 0.12s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (switching) return;
                      e.currentTarget.style.background = `linear-gradient(180deg, ${hexToAlpha(accent, 0.18)} 0%, ${hexToAlpha(accent, 0.06)} 100%)`;
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.08) 100%)";
                      e.currentTarget.style.color = "rgba(255,255,255,0.78)";
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{d.icon}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {d.label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daksh — TWO feedback channels during department switch.
          Both stay on until the activeDepartment prop actually
          flips (server action → router.refresh → RSC reconciled).
          So even if one feels like it disappears early visually,
          the other carries on until the new room is on screen. */}
      {switchable && switchingTo && (
        <>
          <FinanceLoadingOverlay
            show={switching}
            label={`Switching to ${
              DEPARTMENTS.find((x) => x.id === switchingTo)?.label ?? "department"
            }…`}
          />
          {switching && <DeptSwitchTopBar />}
        </>
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

          // Mig 054 follow-on — collapsible group rendering.
          if (entry.type === "group") {
            const visibleChildren = entry.children.filter((c) =>
              c.roles.includes(role),
            );
            if (visibleChildren.length === 0) return null;
            // Single child → render as flat item (no group chrome).
            if (visibleChildren.length === 1) {
              const item = visibleChildren[0];
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
            }
            return (
              <CollapsibleNavGroup
                key={`group-${i}`}
                label={entry.label}
                icon={entry.icon}
                items={visibleChildren}
                isActive={isActive}
              />
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

/** Mig 054 follow-on — collapsible sidebar group.
 *
 *  Renders a "More" row that expands on click (or hover) to reveal
 *  N child links. Behaviour:
 *    • Auto-expands on mount if any child's href matches the
 *      current pathname (so the user lands on a sub-page → sees
 *      where they are without clicking).
 *    • Click the header → toggles open/closed.
 *    • Hover the row → also opens (mouse-leave doesn't auto-close
 *      so users don't lose their place mid-click).
 *    • Active child still renders the gold active-dot, same as
 *      flat items, so the user knows which sub-page they're on.
 */
function CollapsibleNavGroup({
  label,
  icon,
  items,
  isActive,
}: {
  label: string;
  icon: string;
  items: NavItem[];
  isActive: (href: string) => boolean;
}) {
  const containsActive = items.some((it) => isActive(it.href));
  const [open, setOpen] = useState(containsActive);

  // If the pathname changes to one of our children, auto-open.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      style={{ display: "flex", flexDirection: "column" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`nav-link${containsActive ? " nav-link-active" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
          // Match the rest of the nav-link rows. The .nav-link class
          // handles padding / color; we just add a tiny chevron on
          // the right + a small badge with child count.
        }}
      >
        <span className="nav-icon">{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 7px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.08)",
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {items.length}
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: "var(--muted)",
            transition: "transform 0.18s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            paddingLeft: 14,
            marginTop: 2,
            marginBottom: 4,
            borderLeft: "1px dashed var(--border)",
            marginLeft: 18,
          }}
        >
          {items.map((it) => {
            const active = isActive(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`nav-link${active ? " nav-link-active" : ""}`}
                style={{ fontSize: 13 }}
              >
                <span className="nav-icon">{it.icon}</span>
                {it.label}
                {active && <span className="nav-active-dot" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mig 058 follow-on — top-of-viewport progress bar shown during
 *  the department switch. Lives alongside FinanceLoadingOverlay so
 *  there's still visible feedback if the overlay drops a beat before
 *  the page actually paints. Matches the visual language of
 *  NavigationProgress (gold gradient + glow) so the two indicators
 *  feel like the same primitive. */
function DeptSwitchTopBar() {
  return (
    <>
      <style>{`
        @keyframes mtcpl-deptbar-progress {
          0%   { transform: translateX(-100%); }
          55%  { transform: translateX(40%); }
          100% { transform: translateX(220%); }
        }
        @keyframes mtcpl-deptbar-glow {
          0%, 100% { opacity: 0.9; }
          50%      { opacity: 1; }
        }
      `}</style>
      <div
        role="progressbar"
        aria-label="Switching department"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          background: "rgba(201, 161, 74, 0.18)",
          zIndex: 10000,
          overflow: "hidden",
          pointerEvents: "none",
          animation: "mtcpl-deptbar-glow 1.8s ease-in-out infinite",
          boxShadow: "0 0 14px rgba(201, 161, 74, 0.55)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "45%",
            background:
              "linear-gradient(90deg, rgba(201,161,74,0) 0%, #d4ad58 25%, #c9a14a 50%, #a4823a 75%, rgba(164,130,58,0) 100%)",
            animation: "mtcpl-deptbar-progress 1.1s ease-in-out infinite",
            boxShadow:
              "0 0 18px rgba(201, 161, 74, 0.95), 0 1px 4px rgba(164,130,58,0.6)",
          }}
        />
      </div>
    </>
  );
}
