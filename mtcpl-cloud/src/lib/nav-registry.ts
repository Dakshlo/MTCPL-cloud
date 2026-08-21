/**
 * The app's navigation registry — every page, with the roles and department
 * that may see it (Daksh, Aug 2026).
 *
 * This used to live inside sidebar.tsx. It moved out when the ⌘K palette
 * needed the same list to power "search all pages" and per-user pinned links:
 * two copies of a 47-page nav would have drifted the first time somebody added
 * a screen. A PLAIN module, not a "use client" one, so a server component can
 * import it without turning the array into a client-reference proxy.
 *
 * WHAT IS DELIBERATELY ABSENT. The royalty and personal-ledger screens are not
 * in here, because they are not in the sidebar either — they are reached by
 * their own hidden triggers. Anything driven off this registry (page search,
 * pinned links) therefore cannot surface them, which is the point.
 */

import type { AppRole } from "@/lib/types";
import { VEHICLES_ROLES } from "@/lib/vehicles-access";
import type { Department } from "@/lib/departments";
import { canViewCncCosts, canViewCutterCosts, canViewVariousCosting } from "@/lib/expenses-permissions";
import { canSeeMarketNews } from "@/lib/market-news-access";
import { canUseTender } from "@/app/(app)/reports/temple-pnl/tender-model";

export type NavItem = {
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

export type NavDivider = {
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
export type NavGroup = {
  type: "group";
  label: string;
  icon: string;
  /** Union of all children's roles — sidebar uses this for the
   *  same role-include filter as flat items. */
  roles: AppRole[];
  department?: Department;
  children: NavItem[];
};

export type NavEntry = NavItem | NavDivider | NavGroup;


export const navEntries: NavEntry[] = [
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
    // Mig 123 — Temple View: slabs organised by component, per temple.
    // Placed directly under Dashboard (Daksh). Same read audience as
    // Required Sizes.
    href: "/temples",
    label: "Temple View",
    icon: "🏛",
    // Daksh (June 2026) — carving_head + tender_manager: full Temple View access.
    roles: ["developer", "owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry", "carving_head", "tender_manager"],
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
    // Daksh (June 2026) — tender_manager added (Production carving access).
    roles: ["developer", "owner", "vendor", "carving_head", "senior_incharge", "cnc_expense_entry", "crosscheck", "tender_manager"],
    department: "production",
  },
  {
    href: "/slabs/ready/for-carving",
    label: "Ready Sizes Stock",
    icon: "📦",
    // Mig 076 — senior_incharge also lands here for the assign flow.
    // Daksh (June 2026) — tender_manager added (Production carving access).
    roles: ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"],
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
    // Daksh (June 2026) — tender_manager added (full carving access).
    roles: ["developer", "owner", "carving_head", "senior_incharge", "team_head", "tender_manager"],
    // Mig 074 — also visible to carving-head-lite. The page itself
    // hides the Awaiting Review tab for flag-only holders so they
    // don't sign off on their own work.
    requiresFlag: "can_assign_carving",
    department: "production",
  },
  {
    // Mig 215 — Carving Plan: per-route load (CNC / Outsource / No
    // carving), the undecided queue + quick-tag, and the CNC capacity
    // forecast. The office roles that route slabs (same set as Ready
    // Sizes Stock).
    href: "/carving/plan",
    label: "CNC Logbook",
    icon: "🗺️",
    roles: ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"],
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
    // Mig 133 (Daksh) — Dispatch + Site pulled out of CARVING into
    // their own section: the post-carving "leave the workshop → reach
    // the temple site" flow. Roles = union of the two children below so
    // the header never orphans (each role here has ≥1 visible child).
    type: "divider",
    label: "DISPATCH & SITE",
    roles: ["developer", "owner", "carving_head"],
    department: "production",
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    // Mig 076 round 2 — Daksh asked to drop Dispatch from Rajesh's
    // sidebar. He doesn't run the dispatch step; keeping it would
    // surface a queue he never acts on.
    icon: "🚚",
    // dispatch = the dispatch incharge (their main workspace). senior_incharge
    // added back (Jun 2026) since they now approve dispatches.
    roles: ["developer", "owner", "carving_head", "senior_incharge", "dispatch"],
    department: "production",
  },
  {
    // Mig 133 — Site / Installation: the stage after dispatch. Unload
    // delivered trucks into yards, keep stock, mark slabs installed.
    // Daksh (June 2026) — owner + developer only for now; per-temple
    // site_incharge scoping (and wider access) comes later.
    href: "/site",
    label: "Site / Installation",
    icon: "🧱",
    roles: ["developer", "owner"],
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
    roles: ["developer", "owner", "vendor", "slab_transfer", "storekeeper", "carving_head", "senior_incharge"],
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
        roles: ["developer", "owner", "carving_head", "senior_incharge", "slab_transfer", "storekeeper"],
        department: "production",
      },
      // Daksh (June 2026) — CNC Expenses / Cutter Expenses / Various
      // Costing removed from the developer "More" group: each is already
      // reachable elsewhere (dashboard Various Costing card → drill into
      // the CNC / cutter reports; the expense-entry roles have their own
      // direct sidebar links). Keeping only My Jobs + Slab Transfer here.
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
    // Mig 104 — Tender Manager owns this; senior_incharge + carving_head
    // also get Register access.
    roles: ["developer", "owner", "tender_manager", "senior_incharge", "carving_head"],
    department: "register",
  },
  // ── MAINTENANCE section (mig 108+) — company machine registry. The
  //    repair-ticket workflow is shelved for now; the board is a simple
  //    Working / Under-maintenance view. owner/developer manage; crosscheck
  //    (Manager) is view + mark-maintenance only (the page hides the
  //    Edit-machines controls for them).
  {
    type: "divider",
    label: "MAINTENANCE",
    roles: ["developer", "owner", "crosscheck"],
    department: "maintenance",
  },
  {
    href: "/maintenance",
    label: "Machines",
    icon: "🛠️",
    roles: ["developer", "owner", "crosscheck"],
    department: "maintenance",
  },
  // ── EMPLOYEES section (mig 189/193/195) — employee master + monthly salary
  //    batches + PF / ESI records + the HDFC bulk-payment sheet. Own tables;
  //    owner / developer / both accountants / EMPLOYEE REGISTER role.
  {
    type: "divider",
    label: "EMPLOYEES",
    roles: ["developer", "owner", "accountant", "accountant_star", "employee_register"],
    department: "salary",
  },
  {
    href: "/salary",
    label: "Employees",
    icon: "👥",
    roles: ["developer", "owner", "accountant", "accountant_star", "employee_register"],
    department: "salary",
  },
  {
    href: "/salary/pay",
    label: "Pay salary",
    icon: "💵",
    roles: ["developer", "owner", "accountant", "accountant_star", "employee_register"],
    department: "salary",
  },
  {
    href: "/salary/records",
    label: "Records",
    icon: "📊",
    roles: ["developer", "owner", "accountant", "accountant_star", "employee_register"],
    department: "salary",
  },
  {
    // Mig 198 — owner approves salary batches before their HDFC CSV unlocks.
    href: "/salary/approvals",
    label: "Batch approval",
    icon: "✅",
    roles: ["developer", "owner"],
    department: "salary",
  },
  // ── VEHICLES section (mig 204) — vehicle document management. EMI monitor,
  //    government papers, insurance / PUC / fitness expiries. Owner + dev only.
  {
    type: "divider",
    label: "VEHICLES",
    roles: VEHICLES_ROLES,
    department: "vehicles",
  },
  {
    href: "/vehicles",
    label: "Overview",
    icon: "🧭",
    roles: VEHICLES_ROLES,
    department: "vehicles",
  },
  {
    href: "/vehicles/commercial",
    label: "Commercial",
    icon: "🚛",
    roles: VEHICLES_ROLES,
    department: "vehicles",
  },
  {
    href: "/vehicles/personal",
    label: "Personal",
    icon: "🚗",
    roles: VEHICLES_ROLES,
    department: "vehicles",
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
    // Daksh (Jun 2026) — Install Contract belongs to Invoicing (reached from
    // the Invoicing dashboard). This sidebar link is ONLY for the Manager
    // (crosscheck): they issue installation contracts but have no Invoicing
    // room, so it lives in their Finance room as their only way in. Everyone
    // else uses the Invoicing dashboard button — hence not shown to them here.
    href: "/invoicing/install-contract",
    label: "Install Contract",
    icon: "📜",
    roles: ["crosscheck"],
    department: "finance",
  },
  {
    href: "/accounts",
    label: "Due Bills",
    icon: "💰",
    roles: ["developer", "owner", "accountant", "accountant_star"],
    department: "finance",
  },
  // Owner's whole-department analysis (Daksh, Aug 2026). Listed for
  // owner + developer here; the PAGE itself narrows owner down to the
  // named owner (NARESH), the same convention cutting-permissions.ts
  // uses — so a second owner account sees the link but gets bounced.
  {
    href: "/accounts/analysis",
    label: "Finance Analysis",
    icon: "📈",
    roles: ["developer", "owner"],
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
    // accountant included so the section header shows when a plain
    // accountant switches into Invoicing (their only entry below is
    // Work Order Doc).
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  {
    href: "/invoicing",
    label: "Dashboard",
    icon: "📊",
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  // Parties moved to a dashboard button (Daksh) — no menu entry.
  {
    href: "/invoicing/challans",
    label: "Challans",
    icon: "📋",
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  // Mig 176 — non-temple goods: create a challan → convert to invoice.
  {
    href: "/invoicing/other",
    label: "Other Sales",
    icon: "🏷",
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  {
    href: "/invoicing/invoices",
    label: "Invoices",
    icon: "🧾",
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  // Daksh Jul 2026 — Approval promoted to a menu entry (was a dashboard button);
  // shows a count of invoices awaiting owner approval.
  {
    href: "/invoicing/approval",
    label: "Approval",
    icon: "🟡",
    roles: ["developer", "owner", "accountant_star", "accountant"],
    department: "invoicing",
  },
  // Daksh: the invoicing menu is lean for EVERYONE (incl. owner/developer) —
  // Approval, Client billing & GST, Work Order Doc and Install contract are all
  // dashboard buttons, not menu entries.
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

/** Flatten the registry to the pages a given role+department may open.
 *  Dividers and group shells drop out; a group's children come through as
 *  ordinary pages, since a pin or a search hit points at a real URL. */
/** How many pages one person may pin to the palette. Lives here, not in the
 *  "use server" action file — that may export async functions only. */
export const MAX_QUICK_LINKS = 6;

export type NavPage = { href: string; label: string; icon: string; department: Department };

/** Pages that EXIST and are reachable from the dashboard, but were never given
 *  a sidebar row — the reports, mostly. The palette has to know about them or
 *  "pin Cutter costing" is impossible, which is the first thing anyone asked
 *  for.
 *
 *  Each carries the SAME predicate its own page enforces, imported rather than
 *  re-guessed: a registry that disagrees with the page would either hide a page
 *  someone may open, or offer a door that redirects. */
type ExtraPage = NavPage & { can: (p: { role: AppRole }) => boolean };

const extraPages: ExtraPage[] = [
  { href: "/reports/various-costing", label: "Various Costing", icon: "📊", department: "production", can: canViewVariousCosting },
  { href: "/reports/various-costing/cnc", label: "CNC costing", icon: "📊", department: "production", can: canViewCncCosts },
  { href: "/reports/various-costing/cutter", label: "Cutter costing", icon: "✂", department: "production", can: canViewCutterCosts },
  { href: "/carving/time", label: "Carving time", icon: "⏱", department: "production",
    can: (p) => ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"].includes(p.role) },
  { href: "/reports/dpr", label: "DPR", icon: "🏭", department: "production",
    can: (p) => ["owner", "developer"].includes(p.role) },
  { href: "/reports/temple-pnl", label: "Temple P&L", icon: "📈", department: "production",
    can: (p) => p.role === "developer" },
  { href: "/reports/tender", label: "Tender / Price Breakdown", icon: "🧮", department: "production",
    can: (p) => canUseTender(p.role) },
  { href: "/market-news", label: "Market brief & chat", icon: "📰", department: "production", can: canSeeMarketNews },
  { href: "/ask-ai", label: "MTCPL-AI", icon: "✦", department: "production",
    can: (p) => ["owner", "developer"].includes(p.role) },
  // The Work Diary is genuinely everyone's.
  { href: "/diary", label: "Work Diary", icon: "📒", department: "production", can: () => true },
];

export function pagesFor(role: AppRole, dept: Department | null, flags?: { can_assign_carving?: boolean | null }): NavPage[] {
  const out: NavPage[] = [];
  const take = (it: NavItem) => {
    const allowed =
      it.roles.includes(role) ||
      (it.requiresFlag === "can_assign_carving" && !!flags?.can_assign_carving);
    if (!allowed) return;
    out.push({ href: it.href, label: it.label, icon: it.icon, department: it.department ?? "production" });
  };
  for (const e of navEntries) {
    if ("type" in e && e.type === "divider") continue;
    if ("type" in e && e.type === "group") {
      if (!e.roles.includes(role)) continue;
      for (const child of e.children) take(child);
      continue;
    }
    take(e as NavItem);
  }
  // The sidebar-less pages, each gated by its own page's predicate.
  for (const e of extraPages) {
    if (e.can({ role })) out.push({ href: e.href, label: e.label, icon: e.icon, department: e.department });
  }

  // A page can appear once only. `dept` is accepted for callers that want one
  // department; the palette passes null, because "everything you may open" is
  // the more useful list to search and pin from.
  const seen = new Set<string>();
  const uniq = out.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
  return dept ? uniq.filter((p) => p.department === dept) : uniq;
}

/** Look up one page by href — used to render a saved pin. */
export function pageByHref(href: string): NavPage | null {
  const all = navEntries.flatMap((e) =>
    "type" in e && e.type === "group" ? e.children : "type" in e && e.type === "divider" ? [] : [e as NavItem],
  );
  const hit = all.find((p) => p.href === href);
  return hit ? { href: hit.href, label: hit.label, icon: hit.icon, department: hit.department ?? "production" } : null;
}
