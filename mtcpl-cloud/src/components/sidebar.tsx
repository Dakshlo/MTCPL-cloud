"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/types";
import {
  DEPARTMENTS,
  allowedDepartmentsForRole,
  canSwitchDepartment,
  effectiveDepartment,
  type Department,
} from "@/lib/departments";
import { setActiveDepartmentAction } from "@/app/(app)/department-actions";
import { ThemeToggle } from "./theme-toggle";
// Mig 080 follow-on (Daksh) — shared sign-out flourish hook.
import { useSignOut } from "./sign-out-overlay";

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
  /** Migration 074 — extra visibility via a profile flag. When set,
   *  the entry shows for any user whose profile has that flag set
   *  to TRUE, in addition to the role-based gate above. */
  requiresFlag?: "can_assign_carving";
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
  register:   "#8a6fb0",  // violet — the records / proof register (mig 102)
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
  // Daksh May 2026 — /tasks page is still live as the owner-friendly
  // mobile task hub (mtcpl.org/tasks); the sidebar entry was removed
  // per Daksh ("no need in menu, will bookmark the URL on phone").
  // The topbar Tasks pill remains as the desktop entry point.
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
    roles: ["developer", "owner", "team_head", "senior_incharge", "block_slab_entry", "block_entry"],
    department: "production",
  },
  {
    // Daksh (June 2026) — Block Journey in the menu for team_head
    // (Paresh) ONLY. Dev/owner already reach it from their dashboard, so
    // they're intentionally left off here to keep their rail uncluttered.
    // Page access is already granted via canTransferPlannedSlabs.
    href: "/block-journey",
    label: "Block Journey",
    icon: "🧭",
    roles: ["team_head"],
    department: "production",
  },
  {
    href: "/slabs",
    label: "Required Sizes",
    icon: "▤",
    roles: ["developer", "owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"],
    department: "production",
  },
  {
    href: "/slabs/view",
    label: "Plan Generator",
    icon: "⌘",
    roles: ["developer", "owner", "team_head", "senior_incharge"],
    department: "production",
  },
  // — Section break before workshop / execution items —
  {
    type: "divider",
    label: "WORKSHOP",
    // Mig 060 — cnc_expense_entry sees the WORKSHOP banner so its
    // "Cutter Expenses" item renders under the right header (same
    // person handles CNC + cutter expense entry per Daksh's spec).
    // Mig 076 round 2 — Manager (crosscheck) added so the Cutter
    // Expenses entry below renders under a WORKSHOP header.
    // Daksh (June 2026) — carving_head added so their read-only Cutting
    // entry below renders under this WORKSHOP header.
    roles: ["developer", "owner", "team_head", "senior_incharge", "cutting_operator", "cnc_expense_entry", "crosscheck", "carving_head"],
    department: "production",
  },
  {
    // Daksh (June 2026) — carving_head gets a READ-ONLY view of Cutting
    // (all 4 tabs) to monitor progress. The page already grants them
    // read access; the cutting page hides every write button for the
    // carving_head role.
    href: "/cutting",
    label: "Cutting",
    icon: "✂",
    roles: ["developer", "owner", "cutting_operator", "team_head", "senior_incharge", "carving_head"],
    department: "production",
  },
  {
    // Total Ready Sizes — cutting-side verification view ("what we cut,
    // what came out of which block"). Originally dropped from the
    // carving_head sidebar (Daksh round 1: Parth already has "Ready
    // Sizes Stock", seeing both felt redundant) — but round 3 Daksh
    // asked to put it back for carving_head too. Parth now uses
    // Total Ready Sizes as the cross-check against what's still in
    // his Ready Sizes Stock bucket (i.e. "the cutting team says they
    // produced these N slabs — let me make sure I'm seeing them all").
    href: "/slabs/ready",
    label: "Total Ready Sizes",
    icon: "✦",
    roles: [
      "developer",
      "owner",
      "team_head",
      "senior_incharge",
      "carving_head",
      "block_slab_entry",
    ],
    department: "production",
  },
  {
    // Mig 060 follow-on (Daksh): Cutter Expenses is the data-entry
    // user's primary work surface — only `cnc_expense_entry` sees it
    // as a top-level sidebar entry. Owner / team_head can reach the
    // same page via the dashboard's Various Costing card → drill in.
    // Developer keeps access via the "More" expandable group below.
    //
    // Mig 076 round 2 — Manager (crosscheck) also enters expenses
    // now. Surfaces alongside their other audit duties.
    href: "/cutting/expenses",
    label: "Cutter Expenses",
    icon: "💸",
    roles: ["cnc_expense_entry", "crosscheck"],
    department: "production",
  },
  {
    type: "divider",
    label: "CARVING",
    // Mig 054 — cnc_expense_entry sees the CARVING section header
    // so its single nav item ("CNC Expenses") renders under the
    // right banner. No other carving entries are visible to that
    // role (they're each role-gated independently).
    // Mig 076 round 2 — Manager (crosscheck) added so the CNC
    // Expenses entry below renders under a CARVING header for them.
    roles: ["developer", "owner", "vendor", "carving_head", "senior_incharge", "cnc_expense_entry", "crosscheck"],
    department: "production",
  },
  {
    href: "/slabs/ready/for-carving",
    label: "Ready Sizes Stock",
    icon: "📦",
    // Mig 076 — senior_incharge also lands here for the assign flow.
    roles: ["developer", "owner", "carving_head", "senior_incharge"],
    // Mig 074 — also visible to carving-head-lite (vendors who
    // assign their own work, e.g. Mohit). Daksh May 2026 round 2 —
    // swapped from Required Sizes to this page in Mohit's sidebar:
    // the actionable stockpile is more useful than the abstract
    // requirements list for the carving-assign role.
    requiresFlag: "can_assign_carving",
    department: "production",
  },
  {
    href: "/carving",
    label: "Carving Jobs",
    icon: "🎨",
    // team_head added Daksh May 2026 round 2 — Rajesh lands here to
    // use the "+ External cut slab" data-entry affordance. He can
    // browse the page but his Assign clicks toast (assign actions
    // stay gated to dev/owner/carving_head).
    //
    // Mig 076 — senior_incharge has full carving access (assign +
    // approve Awaiting Review, now "Carving Done Approval").
    roles: ["developer", "owner", "carving_head", "senior_incharge", "team_head"],
    // Mig 074 — also visible to carving-head-lite. The page itself
    // hides the Awaiting Review tab for flag-only holders so they
    // don't sign off on their own work.
    requiresFlag: "can_assign_carving",
    department: "production",
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    // Mig 076 round 2 — Daksh asked to drop Dispatch from Rajesh's
    // sidebar. He doesn't run the dispatch step; keeping it would
    // surface a queue he never acts on.
    icon: "🚚",
    roles: ["developer", "owner", "carving_head"],
    department: "production",
  },
  {
    // Mig 060 follow-on (Daksh): CNC Expenses, like Cutter Expenses,
    // is the data-entry user's work surface only. Owner / carving_head
    // reach the report via the dashboard's Various Costing card. Dev
    // keeps access via the "More" expandable group below.
    //
    // Mig 076 round 2 — Manager (crosscheck) also enters expenses.
    href: "/carving/expenses",
    label: "CNC Expenses",
    icon: "💸",
    roles: ["cnc_expense_entry", "crosscheck"],
    department: "production",
  },
  {
    // Mig 054 follow-on (Daksh): collapsible developer-only group
    // for back-office surfaces the dev needs quick access to but
    // the rest of the team reaches via dashboard cards / direct
    // role-gated entries. Single-role users for whom only ONE
    // child resolves see it as a flat link automatically (the
    // renderer's 1-visible-child path) — that's how vendor /
    // slab_transfer get their flat "My Jobs" / "Slab Transfer"
    // links.
    //
    // Mig 060 follow-on (Daksh): owner + carving_head + cnc_expense_entry
    // removed from outer roles — they no longer have any visible
    // children here (Cutter / CNC / Various are dev-only inside this
    // group, and the entry user has direct sidebar entries above).
    //
    // Daksh May 2026 round 2: owner back in — dad wants the global
    // cockpit ("My Jobs" view of every vendor) for read-mostly
    // oversight + occasional intervention. Same /vendor route the
    // developer uses; staff-vs-vendor scoping is handled inside
    // the route already.
    type: "group",
    label: "More",
    icon: "⋯",
    department: "production",
    // Mig 076 — carving_head + senior_incharge added so the
    // Global My Jobs entry below shows up for them too (read-only
    // oversight tour, gated by readOnlyCockpit on the /vendor page).
    roles: ["developer", "owner", "vendor", "slab_transfer", "carving_head", "senior_incharge"],
    children: [
      {
        href: "/vendor",
        label: "My Jobs",
        icon: "👤",
        // Mig 076 — carving_head + senior_incharge see this entry but
        // /vendor renders read-only for them (no Load / Hold /
        // Complete / Problem buttons; oversight tour only).
        roles: ["developer", "owner", "vendor", "carving_head", "senior_incharge"],
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
        roles: ["developer"],
        department: "production",
      },
      {
        href: "/cutting/expenses",
        label: "Cutter Expenses",
        icon: "💸",
        roles: ["developer"],
        department: "production",
      },
      {
        href: "/reports/various-costing",
        label: "Various Costing",
        icon: "📊",
        roles: ["developer"],
        department: "production",
      },
    ],
  },
  // ── REGISTER department (Mig 101 + 102) — its own switcher tile ──────
  // Standalone, owner/dev-only record of company activities + proof
  // (e.g. demos/samples sent to clients). Tagged to its OWN department
  // so it appears as a 5th switcher room, not a page under Production.
  // Data is fully isolated from every other module. No divider needed —
  // the department tile is the section header for this single-page room.
  {
    href: "/activity-register",
    label: "Activity Register",
    icon: "📒",
    roles: ["developer", "owner"],
    department: "register",
  },
  // ── ACCOUNTS section (Finance department, mig 028 + 037 crosscheck) ──
  {
    type: "divider",
    label: "ACCOUNTS",
    roles: ["developer", "owner", "accountant", "crosscheck", "accountant_star"],
    department: "finance",
  },
  {
    // Mig 037: crosscheck role sees the All Bills list as their
    // primary entry point — they review pending bills from here and
    // also from the top-bar Bills Audit badge.
    href: "/accounts/bills",
    label: "All Bills",
    icon: "📑",
    roles: ["developer", "owner", "accountant", "crosscheck", "accountant_star"],
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
    roles: ["crosscheck", "accountant_star"],
    department: "finance",
  },
  {
    href: "/accounts",
    label: "Due Bills",
    icon: "💰",
    roles: ["developer", "owner", "accountant", "accountant_star"],
    department: "finance",
  },
  {
    href: "/accounts/pay-today",
    label: "Pay Today",
    icon: "💸",
    roles: ["accountant", "accountant_star"],
    department: "finance",
  },
  // Mig 090 — Bank Declines is NOT a sidebar item: it already lives in
  // the topbar Tasks dropdown (owner/dev), so a sidebar entry would be
  // redundant. (Daksh.)
  {
    href: "/accounts/payments",
    label: "Payment History",
    icon: "🗂️",
    roles: ["developer", "owner", "accountant", "accountant_star"],
    department: "finance",
  },
  {
    href: "/accounts/vendors",
    label: "Vendor Account",
    icon: "🏢",
    // Mig 061 follow-on (Daksh): crosscheck added — they need
    // read-access to vendor profiles (GSTIN / bank / address)
    // while reviewing a bill. Edit / archive still gated to
    // canManageBillVendors so they can only view.
    roles: ["developer", "owner", "accountant", "accountant_star", "crosscheck"],
    department: "finance",
  },
  {
    // Mig 073 — vendor advance payments. Owner records, owner
    // confirms, accountant pays + applies to bills.
    href: "/accounts/advances",
    label: "Advances",
    icon: "📥",
    roles: ["developer", "owner", "accountant", "accountant_star"],
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
    roles: ["developer", "owner", "accountant_star"],
    department: "finance",
  },
  {
    // Mig 082 follow-on (Daksh, June 2026) — accountant_star's
    // read-only verification page. Tally-style two-pane spreadsheet
    // of outstanding bills (vendor-wise + bill-wise) for
    // cross-checking against the external accounting software.
    // Sits right under Final Audit because it's the same persona
    // (Govind) doing the same kind of cross-checking — just
    // against books instead of against the bank statement.
    href: "/accounts/reconcile",
    label: "Reconcile",
    icon: "📒",
    roles: ["developer", "owner", "accountant_star"],
    department: "finance",
  },
  // ── INVOICING section (Mig 038 → Mig 058 — party → challan →
  // invoice restructure). Widened from dev/owner-only to also
  // include final_auditor (the starred accountant — Govind today).
  {
    type: "divider",
    label: "INVOICING",
    roles: ["developer", "owner", "accountant_star"],
    department: "invoicing",
  },
  {
    href: "/invoicing",
    label: "Dashboard",
    icon: "📊",
    roles: ["developer", "owner", "accountant_star"],
    department: "invoicing",
  },
  {
    href: "/invoicing/parties",
    label: "Parties",
    icon: "👤",
    roles: ["developer", "owner", "accountant_star"],
    department: "invoicing",
  },
  {
    href: "/invoicing/challans",
    label: "Challans",
    icon: "📋",
    roles: ["developer", "owner", "accountant_star"],
    department: "invoicing",
  },
  {
    href: "/invoicing/invoices",
    label: "Invoices",
    icon: "🧾",
    roles: ["developer", "owner", "accountant_star"],
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
    // Mig 083 follow-on (Daksh, June 2026) — Approval List was
    // also surfaced inside InventoryShell's sub-nav for every
    // role. Storekeeper shouldn't see it (segregation of duties),
    // so the sub-nav now defaults to hidden + the sidebar entry
    // widens to owner / developer too so they can still reach
    // the queue when they need to step in for crosscheck.
    href: "/inventory/approvals",
    label: "Audit Queue",
    icon: "✅",
    roles: ["crosscheck", "owner", "developer"],
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
    // Mig 076 round 2 — Daksh renamed the display label from
    // CROSSCHECK to MANAGER. DB enum stays 'crosscheck' (same
    // display-only pattern accountant_star used before mig 061).
    crosscheck: "MANAGER",
    storekeeper: "STOREKEEPER",
    // Mig 058 — Daksh: "change to accountant with star — we have
    // 2 accountants and don't want to bias one as senior." Mig 061
    // followed up by renaming the DB enum to match
    // (`final_auditor` → `accountant_star`).
    accountant_star: "ACCOUNTANT ★",
    // Mig 060 — was "CNC EXPENSE ENTRY". Renamed to "EXPENSES
    // ENTRY" because the same role now handles BOTH cutter +
    // CNC expenses. Display label only; DB enum stays
    // `cnc_expense_entry`.
    cnc_expense_entry: "EXPENSES ENTRY",
    // Mig 076 — Rajesh's expanded role. Reads as a star above the
    // regular team head pill so the sidebar instantly signals the
    // extra Carving authority.
    senior_incharge: "SENIOR INCHARGE ★",
  };
  return labels[role] ?? role.replace(/_/g, " ").toUpperCase();
}

export function Sidebar({
  role,
  displayName,
  themePreference,
  activeDepartment,
  canAssignCarving = false,
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
  /** Migration 074 — when TRUE the user gets the entries marked
   *  `requiresFlag: "can_assign_carving"` in addition to whatever
   *  their role grants. Layout reads it from profile and passes
   *  through. */
  canAssignCarving?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Mig 080 follow-on (Daksh) — shared sign-out flourish hook. Same
  // visual treatment as the topbar Sign out button (gold-pulsing
  // focal box → ✓ done → hard redirect to /login).
  const triggerSignOut = useSignOut();
  // Daksh (Mig 058 follow-on): dept-switch feedback is a thin gold
  // progress bar pinned to the very top of the viewport (the
  // earlier FinanceLoadingOverlay variant felt too heavy and was
  // removed). Independent of the existing NavigationProgress
  // component — that one only fires for <a> / <form> events;
  // ours fires from a plain button click. Stays visible until we
  // detect the activeDepartment prop has actually changed (server
  // action + router.refresh + RSC reconciliation all completed).
  // Safety net: 12s hard timeout so we never hang forever if
  // something goes wrong server-side.
  const [switching, setSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<Department | null>(null);
  const prevActiveDeptRef = useRef<Department | null>(activeDepartment ?? null);

  // Daksh May 2026 — hamburger / slide-in mobile sidebar. The mobile
  // viewport hides the static sidebar (`transform: translateX(-100%)`
  // in globals.css ≤900px) and renders a fixed hamburger button that
  // toggles `.sidebar-mobile-open` on the aside. A backdrop covers
  // the rest of the screen so tapping outside the panel closes it.
  // Auto-closes when the route changes (user navigated → panel
  // should go away on its own). Bottom-tab MobileNav is now removed
  // from layout.tsx — hamburger is the only mobile nav surface.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    // Close on every route change so a tap-link inside the sidebar
    // also dismisses the drawer.
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    // Esc closes too.
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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
  // Mig 058 follow-on (Daksh) — switcher tiles are filtered to the
  // role's allowed list. ACCOUNTANT★ (final_auditor) sees only
  // Finance + Invoicing; dev/owner still see all 4.
  const allowedDepts = allowedDepartmentsForRole(role);
  const visibleDeptTiles = DEPARTMENTS.filter((d) => allowedDepts.includes(d.id));

  // Step 1: role OR flag filter. Mig 074 — entries with a
  // `requiresFlag` ALSO match when the profile has that flag set,
  // even if the role isn't in the role list. Dividers + groups
  // stay role-only (groups self-filter via their children's
  // visibility anyway).
  let visibleEntries = navEntries.filter((entry) => {
    if (entry.roles.includes(role)) return true;
    if (entry.type === "item" || entry.type === undefined) {
      const item = entry as NavItem;
      if (item.requiresFlag === "can_assign_carving" && canAssignCarving) {
        return true;
      }
    }
    return false;
  });

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
    // Mig 060 — /cutting/expenses lit only on that page; /cutting
    // sibling matches only the cutting jobs root (not the expenses
    // sub-route), so the two entries stay disambiguated.
    if (href === "/cutting/expenses") return pathname.startsWith("/cutting/expenses");
    if (href === "/cutting") return pathname === "/cutting" || (pathname.startsWith("/cutting/") && !pathname.startsWith("/cutting/expenses"));
    // Mig 060 — Various Costing report tree lights when on landing
    // or any of its sub-routes (CNC / Cutter).
    if (href === "/reports/various-costing") return pathname.startsWith("/reports/various-costing");
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
    <>
      {/* Hamburger trigger — visible only on mobile via the
          .hamburger-btn @media block in globals.css. Sits fixed
          top-left over the page content. */}
      <button
        type="button"
        className="hamburger-btn"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Open menu"
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? "✕" : "☰"}
      </button>
      {/* Backdrop — only rendered when the drawer is open. Tap it to
          close. The .sidebar-backdrop @media block already styles
          it as a fullscreen dim overlay. */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
    <aside className={`sidebar${mobileOpen ? " sidebar-mobile-open" : ""}`}>
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
            {visibleDeptTiles.map((d) => {
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

      {/* Daksh — dept-switch feedback. The FinanceLoadingOverlay
          variant felt too heavy; keep only the thin top progress
          bar. It stays visible until the activeDepartment prop
          actually flips (server action → router.refresh → RSC
          reconciled), so the bar covers the full visible-transition
          window — no flash. */}
      {switchable && switching && (
        <DeptSwitchTopBar targetDept={switchingTo} />
      )}

      {/* User */}
      <div className="sidebar-user">
        <div className="sidebar-user-name">{displayName || "MTCPL User"}</div>
        <div
          className="sidebar-user-role"
          style={
            role === "team_head"
              ? { color: "#7eaadc", fontWeight: 700 }
              : role === "senior_incharge"
              ? // Mig 076 — emerald + extra weight to stand out from
                // TEAM HEAD's light blue. Rajesh-tier badge.
                { color: "#34d399", fontWeight: 800, letterSpacing: "0.04em" }
              : undefined
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
        {/* Mig 080 follow-on — was a form POST to /api/auth/signout
            (no such route existed, so it silently failed). Now uses
            the shared useSignOut() hook for the gold-pulse flourish
            + reliable client-side supabase.auth.signOut() call. */}
        <button
          className="logout-btn"
          type="button"
          onClick={triggerSignOut}
        >
          Sign out
        </button>
      </div>
    </aside>
    </>
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
 *  the department switch. Matches the visual language of
 *  NavigationProgress (gold gradient + glow). Lives at z-index
 *  10000 so it sits above app chrome.
 *
 *  Daksh May 2026 round 2 — added a centered full-screen overlay
 *  alongside the thin bar. Dad's complaint: he'd click a
 *  department, the URL bar showed it was loading, but nothing
 *  visible happened on the page for a few seconds — felt frozen.
 *  The 5-px gold bar at the top was too subtle. The new overlay
 *  blocks the rest of the page behind a soft backdrop with the
 *  MTCPL logo + a gold spinning ring + "Switching to X…" text so
 *  the loading state is unmistakable. Both layers render
 *  together — the bar still gives the "progress is happening at
 *  the top edge" cue, the overlay is the focal centerpiece. */
function DeptSwitchTopBar({ targetDept }: { targetDept: Department | null }) {
  const meta = targetDept
    ? DEPARTMENTS.find((d) => d.id === targetDept)
    : null;
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
        @keyframes mtcpl-dept-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes mtcpl-dept-logo-breath {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        @keyframes mtcpl-dept-ring-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes mtcpl-dept-dots {
          0%, 20%   { content: ""; }
          40%       { content: "."; }
          60%       { content: ".."; }
          80%, 100% { content: "..."; }
        }
      `}</style>

      {/* Thin top bar — same as before */}
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
          zIndex: 10001,
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

      {/* Full-screen centered overlay — logo + spinning gold ring
          + "Switching to X…" text. Blocks pointer events so dad
          can't double-click another department mid-switch. */}
      <div
        aria-live="polite"
        aria-label={meta ? `Switching to ${meta.label}` : "Switching department"}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "rgba(15, 23, 42, 0.55)",
          backdropFilter: "blur(8px) saturate(140%)",
          WebkitBackdropFilter: "blur(8px) saturate(140%)",
          animation: "mtcpl-dept-overlay-in 0.18s ease-out both",
        }}
      >
        {/* Logo + spinning ring stack. The ring rotates outside
            the logo; the logo itself breathes (subtle scale
            pulse) so the user knows the page is alive. */}
        <div
          style={{
            position: "relative",
            width: 132,
            height: 132,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Outer gold ring (1 segment missing → looks like a
              spinner). 1.2 s rotation. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              border: "4px solid rgba(201, 161, 74, 0.18)",
              borderTopColor: "#c9a14a",
              borderRightColor: "rgba(201, 161, 74, 0.55)",
              borderRadius: "50%",
              animation: "mtcpl-dept-ring-spin 1.2s linear infinite",
              boxShadow: "0 0 24px rgba(201, 161, 74, 0.35)",
            }}
          />
          {/* Soft glow circle behind the logo */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 14,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 50% 50%, rgba(201,161,74,0.16) 0%, transparent 65%)",
              filter: "blur(4px)",
            }}
          />
          {/* The logo itself. /logo-dark.png is the gold mark on
              dark-overlay-friendly stock. Filter brightness/invert
              brings it bright so it reads against the slate
              backdrop. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-dark.png"
            alt="MTCPL"
            style={{
              width: 72,
              height: "auto",
              position: "relative",
              zIndex: 1,
              filter:
                "brightness(0) invert(1) drop-shadow(0 2px 8px rgba(0,0,0,0.45))",
              animation: "mtcpl-dept-logo-breath 2.2s ease-in-out infinite",
            }}
          />
        </div>

        {/* "Switching to {label}…" — big enough to read at a
            glance, gold accent on the dept name. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            color: "#fff",
            textAlign: "center",
            textShadow: "0 1px 4px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            Switching to
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              color: "#fde68a", // soft gold so it reads as accented
              display: "inline-flex",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            {meta ? (
              <>
                <span aria-hidden style={{ fontSize: 22 }}>
                  {meta.icon}
                </span>
                {meta.label}
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: "1.4ch",
                    textAlign: "left",
                  }}
                >
                  {/* animated dots after the label */}
                  <span
                    style={{
                      display: "inline-block",
                      animation: "mtcpl-dept-dots 1.2s steps(1, end) infinite",
                    }}
                  >
                    …
                  </span>
                </span>
              </>
            ) : (
              <>Department…</>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
