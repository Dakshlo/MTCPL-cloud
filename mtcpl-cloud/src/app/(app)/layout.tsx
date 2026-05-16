import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { headers, cookies } from "next/headers";

import { LogoutButton } from "@/components/logout-button";
import { MobileNav } from "@/components/mobile-nav";
import { NotificationBell } from "@/components/notification-bell";
import { NavigationProgress } from "@/components/navigation-progress";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RouteTracker } from "@/components/route-tracker";
import { Sidebar } from "@/components/sidebar";
import { TopbarTasksBadge, type TopbarTask } from "@/components/topbar-tasks-badge";
import { TopbarIdLookup } from "@/components/topbar-id-lookup";
import { Toast } from "@/components/toast";
import { Heartbeat } from "@/components/heartbeat";
import { LoginLocationProbe } from "@/components/login-location-probe";
import { requireAuth } from "@/lib/auth";
import { canApproveCuts } from "@/lib/cutting-permissions";
import {
  canApproveBills,
  canConfirmPayments,
  canFinalAudit,
} from "@/lib/accounts-permissions";
import { canApproveInventoryMovements } from "@/lib/inventory-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getEffectiveStatus, getDepartmentStatus } from "@/lib/system-status";
import {
  DEPARTMENTS,
  departmentForRoute,
  effectiveDepartment,
  rolePermittedDepartments,
  type Department,
} from "@/lib/departments";
import { getProfilesMap } from "@/lib/profiles";
import { SystemDownScreen } from "@/components/system-down-screen";
import { DEV_BYPASS_COOKIE } from "@/lib/dev-bypass";
import { disableDevMaintenanceBypassAction } from "@/app/(app)/settings/system-status-actions";

const SETTINGS_ROLES = ["developer", "owner", "team_head"];
const NOTIFICATION_ROLES = ["developer"]; // flip to include "team_head" at rollout

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";

  // Pathname from middleware (Migration 036). Used to figure out which
  // department the current route belongs to so the maintenance check
  // can be department-aware. Falls back to '/' if the header is missing
  // (e.g. middleware not yet redeployed) — that maps to Production.
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/";
  const requestDept = departmentForRoute(pathname);

  // ── System maintenance gate (migration 031 + 036) ──────────────
  // Two layers: a global flag (legacy from migration 031) AND three
  // per-department flags (Migration 036). getEffectiveStatus returns
  // the first DOWN it finds across (global, then this route's
  // department).
  //
  // Developer override: a developer can click "Access system anyway"
  // on the lock screen to set DEV_BYPASS_COOKIE on their browser.
  // While that cookie is present we skip the down screen and let
  // the dev continue into the app — but render a yellow override
  // banner across the top of every page so they never forget the
  // rest of the team is locked out.
  const cookieJar = await cookies();
  const hasDevBypass =
    profile.role === "developer" &&
    cookieJar.get(DEV_BYPASS_COOKIE)?.value === "1";

  const effectiveStatus = await getEffectiveStatus(requestDept);
  if (effectiveStatus.down && !hasDevBypass) {
    let updatedByName: string | null = null;
    if (effectiveStatus.updatedBy) {
      try {
        const map = await getProfilesMap();
        updatedByName = map[effectiveStatus.updatedBy] ?? null;
      } catch {
        updatedByName = null;
      }
    }
    const scopeLabel =
      effectiveStatus.source === "global"
        ? "All systems"
        : requestDept === "production"
          ? "Production"
          : requestDept === "finance"
            ? "Finance"
            : "Inventory";
    const decoratedMessage = effectiveStatus.message
      ? `${scopeLabel} · ${effectiveStatus.message}`
      : `${scopeLabel} is currently offline.`;

    // Quick-jump to other departments still live. Two filters:
    //   1. Only per-department locks qualify — a global lock means
    //      every alternative is also locked, so there's nowhere to
    //      jump to.
    //   2. Filter to departments the user's role permits — dev/owner
    //      get all three; accountant gets Finance; cutting roles get
    //      Production; etc. Even locked roles see this panel — an
    //      accountant who somehow lands on /dashboard during a
    //      Production lock should still see "Go to Finance" so they
    //      can get back to their actual workspace.
    let availableDepartments: Array<{
      id: string;
      label: string;
      icon: string;
      href: string;
    }> = [];
    if (effectiveStatus.source === "department") {
      const permittedDepts = rolePermittedDepartments(profile.role);
      const otherPermitted = permittedDepts.filter((d) => d !== requestDept);
      if (otherPermitted.length > 0) {
        const statuses = await Promise.all(
          otherPermitted.map((d) => getDepartmentStatus(d)),
        );
        for (let i = 0; i < otherPermitted.length; i++) {
          const dId = otherPermitted[i];
          if (statuses[i].down) continue;
          const meta = DEPARTMENTS.find((d) => d.id === dId);
          if (!meta) continue;
          availableDepartments.push({
            id: dId,
            label: meta.label,
            icon: meta.icon,
            href: meta.landingHref,
          });
        }
      }
    }

    return (
      <SystemDownScreen
        isDeveloper={profile.role === "developer"}
        message={decoratedMessage}
        updatedAt={effectiveStatus.updatedAt}
        updatedByName={updatedByName}
        availableDepartments={availableDepartments}
      />
    );
  }

  // If we got here AND the system is actually down, the dev is in
  // bypass mode. Capture that so we can render the override banner
  // below.
  const inDevBypass = effectiveStatus.down && hasDevBypass;
  const bypassScopeLabel = inDevBypass
    ? effectiveStatus.source === "global"
      ? "all systems"
      : requestDept === "production"
        ? "Production"
        : requestDept === "finance"
          ? "Finance"
          : "Inventory"
    : null;

  // Cut-approval queue size — only loaded for approvers (migration 027).
  // Cheap single-COUNT query, indexed by the partial index added in 027.
  let approvalsBadge: number | null = null;
  let billsAuditBadge: number | null = null;
  let payTodayBadge: number | null = null;
  let inventoryAuditBadge: number | null = null;
  // Mig 053 — Final Audit queue count (paid + awaiting UTR
  // verification). Final auditor + owner + dev see it.
  let finalAuditBadge: number | null = null;
  const supabase = createAdminSupabaseClient();
  if (canApproveCuts(profile)) {
    const { count } = await supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .in("status", ["awaiting_approval", "awaiting_cutter_edit"]);
    approvalsBadge = count ?? 0;
  }
  // Bills Audit badge — approvers see the count of bills waiting for
  // approval (migration 028). Mirrors Cutting Audit badge styling.
  if (canApproveBills(profile)) {
    const { count } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    billsAuditBadge = count ?? 0;
  }
  // Pay Today badge — owner + developer only. Accountant gets a
  // sidebar entry instead. Crosscheck (mig 037) intentionally
  // EXCLUDED — they only verify bills, never participate in the
  // payment-confirm step. Gate on canConfirmPayments (which omits
  // crosscheck) rather than canApproveBills (which includes them).
  if (canConfirmPayments(profile)) {
    const { count } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .in("status", ["proposed", "confirmed"]);
    payTodayBadge = count ?? 0;
  }
  // Inventory Audit badge — Mig 041. Crosscheck (Mafat) + owner +
  // dev see pending storekeeper submissions. Indexed by the partial
  // inventory_movements_pending_idx so the COUNT is sub-millisecond.
  // The badge counts BATCHES (distinct batch_id), not rows — a 6-item
  // issue is one decision, not six.
  if (canApproveInventoryMovements(profile)) {
    const { data: pendingBatches, error: pendingBatchesError } = await supabase
      .from("inventory_movements")
      .select("batch_id")
      .eq("status", "pending_approval");
    if (pendingBatchesError) {
      // Migration 041 not yet run on this environment → hide the
      // badge entirely. Otherwise it would flash a misleading "0".
      inventoryAuditBadge = null;
    } else {
      const uniqueBatches = new Set(
        (pendingBatches ?? []).map((r) => r.batch_id as string),
      );
      inventoryAuditBadge = uniqueBatches.size;
    }
  }
  // Mig 053 — Final Audit queue. Counts paid payments awaiting UTR
  // recheck. Indexed by bill_payments_final_audit_pending_idx so the
  // partial-index COUNT is essentially free.
  if (canFinalAudit(profile)) {
    const { count, error: finalAuditErr } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("final_audit_status", "pending");
    if (finalAuditErr) {
      // Migration 053 not yet run → hide the badge silently.
      finalAuditBadge = null;
    } else {
      finalAuditBadge = count ?? 0;
    }
  }

  return (
    <div className="app-shell">
      <NavigationProgress />
      <RealtimeRefresh />
      {/* Mig 053 follow-on — SPA route tracker. Captures every Next
          client-side navigation into sessionStorage so the bill
          detail page's back link can show "← {wherever you came
          from}" with the exact URL preserved (filters intact).
          Wrapped in Suspense because useSearchParams() requires it
          when not statically prerendered. */}
      <Suspense fallback={null}>
        <RouteTracker />
      </Suspense>
      <Heartbeat />
      {/* Mig 046 — one-shot login-location probe. Captures IP + city
          server-side, and tries browser GPS once per session. Fully
          fire-and-forget; never blocks anything. Visible in the Live
          Users panel on /settings (developer + owner). */}
      <LoginLocationProbe />
      <Sidebar
        displayName={displayName}
        role={profile.role}
        themePreference={profile.theme_preference ?? null}
        activeDepartment={effectiveDepartment(profile.role, profile.active_department ?? null)}
      />

      <main className="main-shell">
        {/* Developer maintenance-bypass banner. Only renders when the
            current dev has the bypass cookie AND the system is still
            in a down state. Visible across every authenticated page
            so the dev never forgets the rest of the team is locked
            out. Click "Exit override" to drop the cookie + go back
            to the lock screen. */}
        {inDevBypass && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 16px",
              background: "rgba(251, 191, 36, 0.15)",
              borderBottom: "1.5px solid #f59e0b",
              color: "#78350f",
              fontSize: 12,
              fontWeight: 600,
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true">🔓</span>
              <span>
                <strong>Admin override active.</strong> Maintenance is on for{" "}
                {bypassScopeLabel ?? "everyone"} — you can still work, but the
                rest of the team is locked out.
              </span>
            </span>
            <form action={disableDevMaintenanceBypassAction}>
              <button
                type="submit"
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "transparent",
                  color: "#78350f",
                  border: "1px solid #b45309",
                  borderRadius: 6,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Exit override
              </button>
            </form>
          </div>
        )}
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-label">Signed in as</span>
            <Link
              href="/profile"
              className="topbar-name"
              title="Click to update your display name"
              style={{ textDecoration: "none", borderBottom: "1px dashed var(--border)", cursor: "pointer" }}
            >
              {displayName}
            </Link>
          </div>
          <div className="topbar-right">
            {/* ID Lookup quick-access dropdown — sits to the left of
                the Tasks pill. The pill is always labelled "Find ID";
                its search panel adapts to the active department so
                the user gets relevant results without leaving their
                workspace:
                  Production → slab / block lookup
                  Finance    → bill token / vendor / payment reference
                  Inventory  → site / scaffolding component
                Per-department role gating:
                  Production → developer / owner / team_head /
                               crosscheck / carving_head (unchanged)
                  Finance    → developer / owner / accountant
                  Inventory  → developer / owner only (Daksh:
                               "only roles that hop between
                               departments need it here") */}
            {(() => {
              const dept = effectiveDepartment(
                profile.role,
                profile.active_department ?? null,
              );
              const role = profile.role;
              const showProduction =
                dept === "production" &&
                (role === "developer" ||
                  role === "owner" ||
                  role === "team_head" ||
                  role === "crosscheck" ||
                  role === "carving_head");
              const showFinance =
                dept === "finance" &&
                (role === "developer" ||
                  role === "owner" ||
                  role === "accountant" ||
                  // Mig 053 — final auditor has full finance access.
                  role === "final_auditor");
              const showInventory =
                dept === "inventory" &&
                (role === "developer" || role === "owner");
              if (showProduction) return <TopbarIdLookup domain="production" />;
              if (showFinance) return <TopbarIdLookup domain="finance" />;
              if (showInventory) return <TopbarIdLookup domain="inventory" />;
              return null;
            })()}

            {/* Consolidated tasks dropdown (Mig 044 follow-on per
                Daksh: the four separate pills were clustering the
                top bar). Single trigger pill showing the total
                pending count; hover (or tap) opens a glass dropdown
                with each enabled queue and its individual count.
                The role gating is identical to the old per-pill
                logic — each item is included only if its permission
                helper said yes, so:
                  developer / owner → all four
                  crosscheck (Mafat) → Cutting + Crosscheck + Inventory
                  team_head / carving_head with can_approve_cuts
                    (Rajesh / Parth)    → Cutting Audit only
                  accountant with can_approve_bills → adds Pay Today
                Roles with zero items get nothing rendered. */}
            <TopbarTasksBadge items={buildTopbarTaskItems({
              approvalsBadge,
              billsAuditBadge,
              payTodayBadge,
              inventoryAuditBadge,
              finalAuditBadge,
            })} />

            <span className="role-pill" style={
              profile.role === "developer" ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
              profile.role === "owner"     ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
              profile.role === "team_head" ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } :
              {}
            }>
              {({
                developer: "DEVELOPER",
                owner: "OWNER",
                team_head: "TEAM HEAD",
                block_slab_entry: "BLOCK+SLAB ENTRY",
                slab_entry: "SLAB ENTRY",
                block_entry: "BLOCK ENTRY",
                cutting_operator: "CUTTING OPERATOR",
                biller: "BILLER",
                accountant: "ACCOUNTANT",
                final_auditor: "FINAL AUDITOR",
              } as Record<string, string>)[profile.role] ?? profile.role.replace(/_/g, " ").toUpperCase()}
            </span>
            {NOTIFICATION_ROLES.includes(profile.role) && (
              <NotificationBell userId={profile.id} role={profile.role} />
            )}
            {SETTINGS_ROLES.includes(profile.role) && (
              <Link href="/settings" className="topbar-settings-btn" title="Settings">
                ⚙
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>

        <div className="page-content">
          {children}
        </div>
      </main>
      <MobileNav role={profile.role} displayName={displayName} />
      <Toast />
    </div>
  );
}

/** Build the items array for the consolidated TopbarTasksBadge.
 *  Each helper-gated count (null = role not permitted) maps to a
 *  single item in the dropdown. Roles with no permitted items get
 *  zero items back → the badge hides itself entirely.
 *
 *  Daksh's role rules fall out automatically:
 *    developer / owner            → all four items
 *    crosscheck (Mafat)           → Cutting Audit + Crosscheck +
 *                                   Inventory Audit (canApproveCuts
 *                                   gated by the can_approve_cuts
 *                                   flag on his profile;
 *                                   canApproveBills + canApprove-
 *                                   InventoryMovements include the
 *                                   crosscheck role outright)
 *    team_head / carving_head with can_approve_cuts (Rajesh / Parth)
 *                                 → Cutting Audit only
 *    accountant with can_approve_bills (Naresh)
 *                                 → adds Pay Today + Crosscheck
 *
 *  The helper in layout above returns `null` when a role isn't
 *  permitted (so we can hide the row entirely) and a number
 *  otherwise. Hiding empty queues lets the dropdown stay short.
 */
function buildTopbarTaskItems(counts: {
  approvalsBadge: number | null;
  billsAuditBadge: number | null;
  payTodayBadge: number | null;
  inventoryAuditBadge: number | null;
  finalAuditBadge: number | null;
}): TopbarTask[] {
  const items: TopbarTask[] = [];
  if (counts.approvalsBadge !== null) {
    items.push({
      id: "cutting-audit",
      href: "/cutting/approvals",
      label: "Cutting Audit",
      description: "Cutter submissions awaiting your sign-off",
      count: counts.approvalsBadge,
      icon: "✓",
      department: "production",
    });
  }
  if (counts.billsAuditBadge !== null) {
    items.push({
      id: "crosscheck",
      href: "/accounts/approvals",
      label: "Crosscheck",
      description: "Bills waiting for verification",
      count: counts.billsAuditBadge,
      icon: "✅",
      department: "finance",
    });
  }
  if (counts.payTodayBadge !== null) {
    items.push({
      id: "pay-today",
      href: "/accounts/pay-today",
      label: "Pay Today",
      description: "Proposed + confirmed payments in flight",
      count: counts.payTodayBadge,
      icon: "💸",
      department: "finance",
    });
  }
  if (counts.finalAuditBadge !== null) {
    items.push({
      id: "final-audit",
      href: "/accounts/final-audit",
      label: "Final Audit",
      description: "Paid payments awaiting UTR recheck",
      count: counts.finalAuditBadge,
      icon: "🧾",
      department: "finance",
    });
  }
  if (counts.inventoryAuditBadge !== null) {
    items.push({
      id: "inventory-audit",
      href: "/inventory/approvals",
      label: "Inventory Audit",
      description: "Stock movement batches awaiting audit",
      count: counts.inventoryAuditBadge,
      icon: "📦",
      department: "inventory",
    });
  }
  return items;
}
