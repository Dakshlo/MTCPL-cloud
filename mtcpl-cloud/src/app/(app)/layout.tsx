import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { headers, cookies } from "next/headers";

import { LogoutButton } from "@/components/logout-button";
import { MessengerPill } from "@/components/messenger-pill";
import { NotificationBell } from "@/components/notification-bell";
import { NavigationProgress } from "@/components/navigation-progress";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RouteTracker } from "@/components/route-tracker";
import { Sidebar } from "@/components/sidebar";
import { TopbarTasksBadge, type TopbarTask } from "@/components/topbar-tasks-badge";
import { TopbarIdLookup } from "@/components/topbar-id-lookup";
import { TopbarRefreshButton } from "@/components/topbar-refresh-button";
import { TabletKeyboardProvider } from "@/components/tablet-keyboard";
import { Toast } from "@/components/toast";
import { Heartbeat } from "@/components/heartbeat";
import { LoginLocationProbe } from "@/components/login-location-probe";
// Mig 080 follow-on (Daksh) — host for the shared sign-out flourish.
// Mounted once at the (app) layout root so every Sign out button
// (topbar + sidebar) can trigger the same gold-pulse overlay.
import { SignOutOverlayHost } from "@/components/sign-out-overlay";
import { TvKioskSignOut } from "@/components/tv-kiosk-signout";
import { TvFullscreenGate } from "@/components/tv-fullscreen-gate";
// Idle auto-logout for accounts-desk users (handle money) — 10 min of
// inactivity signs them out, active use keeps the session alive.
import { IdleLogout } from "@/components/idle-logout";
import { requireAuth } from "@/lib/auth";
import { canApproveCuts, canSeeAwaitingReview } from "@/lib/cutting-permissions";
import { canUseMessenger } from "@/lib/messenger-permissions";
import {
  canApproveBills,
  canApproveDebit,
  canConfirmPayments,
  canFinalAudit,
  canSubmitBills,
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

// Mig 081 follow-on (Daksh) — senior_incharge added. The settings
// page itself already permits the role via requireAuth, and the
// sensitive sections (Users / Live Users / Screen Time / Audit Log /
// Backup / Maintenance) gate themselves on developer+owner. So
// dropping senior_incharge into this list surfaces ONLY the
// ungated sections — Stone Types + Temple Codes — which is exactly
// what Rajesh needs.
// Daksh (Jun 2026) — carving_head added. They get a trimmed Settings page
// (Transfer trucks + Temple Codes only); Stone Types and every sensitive
// section stay hidden from them (see settings/page.tsx).
const SETTINGS_ROLES = ["developer", "owner", "team_head", "senior_incharge", "carving_head"];
// Mig 058 follow-on (Daksh, second pass): the generic notification
// bell was too cluttered for the accountant context. Reverted to
// developer-only — the bell stays an internal-debugging surface.
// The rejected-bill alert lives in the Tasks pill instead (see
// rejectedBillsBadge below) where it shares the same visual
// rhythm as Crosscheck / Pay Today / Final Audit counters and
// stays out of the way when there's nothing to act on.
const NOTIFICATION_ROLES = ["developer"];

// Idle auto-logout (Daksh, June 2026): applies to EVERY role except
// developer. 10 min of inactivity signs the user out (active use never
// logs out). Owner is included too — only developer is exempt so debug
// sessions aren't interrupted.

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";

  // "tv" — wall-display kiosk role. No dashboard, no sidebar, no top bar:
  // just the page (the carving floor TV view, which is a full-screen overlay)
  // plus a tiny corner sign-out — the only chrome it needs, since there's no
  // top bar to log out from.
  if (profile.role === "tv") {
    return (
      <>
        {children}
        <TvFullscreenGate />
        <TvKioskSignOut />
      </>
    );
  }

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
  //
  // Daksh May 2026 perf pass — these seven badge queries used to run
  // sequentially via `if (canX) { await … }`. On a slow tablet
  // connection that meant 7× round-trips on EVERY page navigation
  // before the layout could render, easily turning a 200ms page into
  // a 3-second wait. Now we fire all of them in parallel via
  // Promise.all so the layout's badge work caps at the slowest
  // single query, not the sum. Each branch resolves to a `number |
  // null` to preserve the "hide the chip when role doesn't qualify"
  // semantics.
  const supabase = createAdminSupabaseClient();

  // Each helper returns the badge count (or null when the role
  // doesn't qualify / when the table doesn't exist yet).
  async function fetchApprovalsBadge(): Promise<number | null> {
    if (!canApproveCuts(profile)) return null;
    const { count } = await supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .in("status", ["awaiting_approval", "awaiting_cutter_edit"]);
    return count ?? 0;
  }
  async function fetchBillsAuditBadge(): Promise<number | null> {
    if (!canApproveBills(profile)) return null;
    const { count } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    return count ?? 0;
  }
  // Pay Today badge — owner + developer only. Accountant gets a
  // sidebar entry instead. Crosscheck (mig 037) intentionally
  // EXCLUDED — they only verify bills, never participate in the
  // payment-confirm step. Gate on canConfirmPayments (which omits
  // crosscheck) rather than canApproveBills (which includes them).
  async function fetchPayTodayBadge(): Promise<number | null> {
    if (!canConfirmPayments(profile)) return null;
    const { count } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .in("status", ["proposed", "confirmed"]);
    return count ?? 0;
  }
  // Inventory Audit badge — Mig 041. Crosscheck (Mafat) + owner +
  // dev see pending storekeeper submissions. The badge counts BATCHES
  // (distinct batch_id), not rows — a 6-item issue is one decision,
  // not six.
  async function fetchInventoryAuditBadge(): Promise<number | null> {
    if (!canApproveInventoryMovements(profile)) return null;
    const { data: pendingBatches, error: pendingBatchesError } = await supabase
      .from("inventory_movements")
      .select("batch_id")
      .eq("status", "pending_approval");
    if (pendingBatchesError) {
      // Migration 041 not yet run on this environment → hide the
      // badge entirely. Otherwise it would flash a misleading "0".
      return null;
    }
    const uniqueBatches = new Set(
      (pendingBatches ?? []).map((r) => r.batch_id as string),
    );
    return uniqueBatches.size;
  }
  // Mig 058 follow-on — per-user rejected-bills count.
  async function fetchRejectedBillsBadge(): Promise<number | null> {
    if (!canSubmitBills(profile)) return null;
    const { count } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("submitted_by", profile.id)
      .eq("status", "rejected");
    return count ?? 0;
  }
  // Mig 053 — Final Audit queue.
  async function fetchFinalAuditBadge(): Promise<number | null> {
    if (!canFinalAudit(profile)) return null;
    const { count, error: finalAuditErr } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("final_audit_status", "pending");
    if (finalAuditErr) return null;
    return count ?? 0;
  }
  // Mig 085 — Debit approval queue. Owner / developer only — the
  // gate that actually moves money (applies a flagged overpayment as
  // a debit against another bill). Counts pending settlements.
  async function fetchDebitApprovalBadge(): Promise<number | null> {
    if (!canApproveDebit(profile)) return null;
    const { count, error: debitErr } = await supabase
      .from("bill_debit_settlements")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    if (debitErr) return null;
    return count ?? 0;
  }
  // Mig 064 — Royalty Approval queue. Owner / developer only.
  async function fetchRoyaltyApprovalBadge(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error: royaltyErr } = await supabase
      .from("vendor_royalty_entries")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval")
      .is("cancelled_at", null);
    if (royaltyErr) return null;
    return count ?? 0;
  }
  // Daksh May 2026 round 2 — surface the Carving Awaiting Review
  // queue alongside the other approval badges. Same audience as
  // /carving's review tab: owner + developer + carving_head (NOT
  // can_assign_carving holders — they don't sign off on their own
  // work; canSeeAwaitingReview encodes that exclusion).
  async function fetchAwaitingReviewBadge(): Promise<number | null> {
    if (!canSeeAwaitingReview(profile)) return null;
    const { count, error: reviewErr } = await supabase
      .from("carving_items")
      .select("*", { count: "exact", head: true })
      .not("completed_at", "is", null)
      .is("review_approved_at", null);
    if (reviewErr) return null;
    return count ?? 0;
  }
  // Mig 132 — Slab Cancel Requests. Broken slabs flagged by carving_head
  // / senior_incharge anywhere in Carving Jobs or Make Dispatch; the
  // owner approves or rejects each one. Owner / developer only.
  // (Replaced the old "Carving Rejected" queue, which mig 132 retired.)
  async function fetchSlabCancelBadge(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error: scErr } = await supabase
      .from("slab_requirements")
      .select("*", { count: "exact", head: true })
      .not("cancel_requested_at", "is", null)
      .neq("status", "cancelled");
    if (scErr) return null;
    return count ?? 0;
  }
  // Mig 132 — cancelled slabs still awaiting a replace / no-replace decision
  // (status 'cancelled' + cancel_resolution NULL). Drives the BLINKING Temple
  // View nav item + banner (Daksh). Same condition as the Temple View page's
  // cancelAlerts strip.
  async function fetchTempleCancelAlert(): Promise<boolean> {
    const TV_ROLES = ["developer", "owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry", "carving_head", "tender_manager"];
    if (!TV_ROLES.includes(profile.role)) return false;
    const { count, error } = await supabase
      .from("slab_requirements")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled")
      .is("cancel_resolution", null);
    if (error) return false;
    return (count ?? 0) > 0;
  }
  // Mig 090 — Bank Decline approval queue. Owner / developer only —
  // they approve an accountant's request to bank-decline a payment
  // that's already in a downloaded HDFC file (→ bill back to due).
  async function fetchBankDeclineBadge(): Promise<number | null> {
    if (!canConfirmPayments(profile)) return null;
    const { count, error: declErr } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .eq("bank_decline_status", "pending");
    if (declErr) return null;
    return count ?? 0;
  }
  // Mig 098 — Outsource Work Order price approval. Owner / developer
  // only — a new work order can't send slabs to the vendor until the
  // owner approves its price.
  async function fetchWorkOrderApprovalBadge(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error: woErr } = await supabase
      .from("carving_work_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval");
    if (woErr) return null;
    return count ?? 0;
  }
  // Mig 118 — carving slabs escalated to the owner during Carving Done
  // Approval ("Involve owner"). Owner / developer only.
  async function fetchOwnerReviewBadge(): Promise<number | null> {
    if (profile.role !== "owner" && profile.role !== "developer") return null;
    const { count, error: orErr } = await supabase
      .from("carving_items")
      .select("*", { count: "exact", head: true })
      .eq("owner_review_status", "open");
    if (orErr) return null;
    return count ?? 0;
  }
  // Mig 122 — Excel slab-import batches waiting for approval.
  async function fetchSlabImportBadge(): Promise<number | null> {
    if (!["owner", "developer", "senior_incharge", "carving_head"].includes(profile.role)) return null;
    const { count, error: siErr } = await supabase
      .from("slab_import_batches")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (siErr) return null;
    return count ?? 0;
  }
  // Dispatch Approval — provisional dispatches (created, not yet approved)
  // awaiting a senior's sign-off before the truck leaves. Owner / developer /
  // carving_head / senior_incharge.
  async function fetchDispatchApprovalBadge(): Promise<number | null> {
    if (!["owner", "developer", "carving_head", "senior_incharge"].includes(profile.role)) return null;
    const { count, error: dErr } = await supabase
      .from("dispatches")
      .select("*", { count: "exact", head: true })
      .is("approved_at", null)
      .is("delivered_at", null);
    if (dErr) return null;
    return count ?? 0;
  }
  // Mig 167 — Invoice approval (OWNER): priced challans waiting for the owner's
  // final sign-off before they become invoices + release the truck.
  async function fetchInvoiceApprovalBadge(): Promise<number | null> {
    if (!["owner", "developer", "accountant_star"].includes(profile.role)) return null;
    const { count, error: iErr } = await supabase
      .from("challans")
      .select("*", { count: "exact", head: true })
      .not("priced_at", "is", null)
      .is("owner_approved_at", null)
      .is("owner_rejected_at", null)
      .is("cancelled_at", null)
      .is("converted_invoice_id", null);
    if (iErr) return null;
    return count ?? 0;
  }

  const [
    approvalsBadge,
    billsAuditBadge,
    payTodayBadge,
    inventoryAuditBadge,
    rejectedBillsBadge,
    finalAuditBadge,
    royaltyApprovalBadge,
    awaitingReviewBadge,
    slabCancelBadge,
    debitApprovalBadge,
    bankDeclineBadge,
    workOrderApprovalBadge,
    ownerReviewBadge,
    slabImportBadge,
    dispatchApprovalBadge,
    invoiceApprovalBadge,
    templeCancelAlert,
  ] = await Promise.all([
    fetchApprovalsBadge(),
    fetchBillsAuditBadge(),
    fetchPayTodayBadge(),
    fetchInventoryAuditBadge(),
    fetchRejectedBillsBadge(),
    fetchFinalAuditBadge(),
    fetchRoyaltyApprovalBadge(),
    fetchAwaitingReviewBadge(),
    fetchSlabCancelBadge(),
    fetchDebitApprovalBadge(),
    fetchBankDeclineBadge(),
    fetchWorkOrderApprovalBadge(),
    fetchOwnerReviewBadge(),
    fetchSlabImportBadge(),
    fetchDispatchApprovalBadge(),
    fetchInvoiceApprovalBadge(),
    fetchTempleCancelAlert(),
  ]);

  // Tablet keyboard quick-chips — every active temple's code, so the chips
  // show on EVERY field the keyboard attaches to (not just the few with
  // data-temple-codes). Cheap select; deduped + uppercased.
  const { data: templeCodeRows } = await supabase
    .from("temples")
    .select("code_prefix")
    .eq("is_active", true);
  const tabletTempleCodes = [
    ...new Set(
      (templeCodeRows ?? [])
        .map((t) => ((t as { code_prefix?: string | null }).code_prefix ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];

  // Storekeeper (slab_transfer) + dispatch incharge — hide the menu by
  // default and serve a focused, full-width page; the hamburger drawer opens
  // it to switch pages. (See `.app-shell.storekeeper-drawer` in globals.css.)
  const storekeeperDrawer =
    profile.role === "slab_transfer" || profile.role === "storekeeper" || profile.role === "dispatch";

  return (
    <div className={`app-shell${storekeeperDrawer ? " storekeeper-drawer" : ""}`}>
      {/* Daksh May 2026 — rotate-to-landscape prompt. CSS-only;
          renders nothing on desktop or in landscape orientation.
          On a phone in portrait, the .rotate-prompt CSS media
          query in globals.css turns this into a fullscreen overlay
          asking the user to rotate. The overlay disappears
          automatically when the orientation flips to landscape
          (the @media query stops matching). True orientation lock
          isn't possible from a regular browser tab — best we can
          do is firmly suggest it. */}
      <div className="rotate-prompt" aria-hidden>
        <div className="rotate-prompt-icon" aria-hidden>📱↻</div>
        <div className="rotate-prompt-title">Please rotate your phone</div>
        <div className="rotate-prompt-body">
          MTCPL works best in landscape on a phone. Turn your device
          sideways to continue.
        </div>
      </div>
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
      {/* Mig 080 follow-on — sign-out flourish host. Renders the
          full-viewport gold-pulse overlay when any Sign out button
          fires useSignOut(). Mounts as a portal off document.body
          so it sits above every page surface. */}
      <SignOutOverlayHost />
      {/* Idle auto-logout (mig 113 — per-user window). Developer is
          always exempt (0 = off). Everyone else uses their
          idle_logout_minutes if the developer set one in Settings, else
          the 10-minute default; a developer-set 0 means "never" for that
          user. Active use keeps the session alive. */}
      <IdleLogout
        idleMinutes={
          profile.role === "developer"
            ? 0
            : profile.idle_logout_minutes == null
              ? 10
              : profile.idle_logout_minutes
        }
      />
      <Sidebar
        displayName={displayName}
        role={profile.role}
        themePreference={profile.theme_preference ?? null}
        activeDepartment={effectiveDepartment(profile.role, profile.active_department ?? null)}
        canAssignCarving={profile.can_assign_carving === true}
        cancelledSlabAlert={templeCancelAlert}
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
            {/* Daksh May 2026 — link still goes to /profile but
                the page itself is now read-only for non-devs (some
                role gates key off the display name; a self-rename
                would silently revoke those grants). Tooltip + dashed
                underline removed to stop hinting "click to edit". */}
            <Link
              href="/profile"
              className="topbar-name"
              title="View your profile"
              style={{ textDecoration: "none", cursor: "pointer" }}
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
                  // Mig 076 — senior_incharge needs Find ID too;
                  // they work across cutting + carving + slabs.
                  role === "senior_incharge" ||
                  role === "crosscheck" ||
                  // Daksh June 2026 — the Dispatch Incharge works the
                  // dispatch floor (a production dept) and needs to look
                  // up slab / block IDs as trucks load.
                  role === "dispatch" ||
                  role === "carving_head");
              // Daksh May 2026 — vendors also walk the shop floor
              // and stencilled slabs land in their shade; they need
              // Find ID too. Vendor role has no active_department,
              // so we light up the production lookup directly
              // regardless of dept.
              const showProductionForVendor = role === "vendor";
              const showFinance =
                dept === "finance" &&
                (role === "developer" ||
                  role === "owner" ||
                  role === "accountant" ||
                  // Mig 053 — final auditor has full finance access.
                  role === "accountant_star");
              const showInventory =
                dept === "inventory" &&
                (role === "developer" || role === "owner");
              if (showProduction || showProductionForVendor)
                return <TopbarIdLookup domain="production" />;
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
              rejectedBillsBadge,
              inventoryAuditBadge,
              finalAuditBadge,
              royaltyApprovalBadge,
              awaitingReviewBadge,
              slabCancelBadge,
              debitApprovalBadge,
              bankDeclineBadge,
              workOrderApprovalBadge,
              ownerReviewBadge,
              slabImportBadge,
              dispatchApprovalBadge,
              invoiceApprovalBadge,
            })} />

            {/* Mig 078 — Messenger pilot. canUseMessenger is locked
                to developer + owner; everyone else never sees the
                pill. The component owns its panel + realtime sub. */}
            {canUseMessenger(profile) && (
              <MessengerPill
                profile={{
                  id: profile.id,
                  role: profile.role as "owner" | "developer",
                  full_name: profile.full_name,
                }}
              />
            )}

            <span className="role-pill" style={
              profile.role === "developer"       ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
              profile.role === "owner"           ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
              profile.role === "team_head"       ? { background: "#1e3a5f", color: "#fff", fontWeight: 700 } :
              // Mig 076 — emerald + soft glow so Rajesh's pill reads
              // as a tier above TEAM HEAD without clashing with the
              // gold (developer) or black (owner) badges.
              profile.role === "senior_incharge" ? {
                background: "linear-gradient(135deg, #047857 0%, #10b981 100%)",
                color: "#fff",
                fontWeight: 800,
                letterSpacing: "0.04em",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset, 0 1px 3px rgba(16,185,129,0.35)",
              } :
              {}
            }>
              {({
                developer: "DEVELOPER",
                owner: "OWNER",
                team_head: "TEAM HEAD",
                senior_incharge: "SENIOR INCHARGE ★",
                block_slab_entry: "BLOCK+SLAB ENTRY",
                slab_entry: "SLAB ENTRY",
                block_entry: "BLOCK ENTRY",
                cutting_operator: "CUTTING OPERATOR",
                biller: "BILLER",
                accountant: "ACCOUNTANT",
                accountant_star: "ACCOUNTANT ★",
                // Mig 076 round 2 — display-only rename. DB enum
                // stays 'crosscheck'.
                crosscheck: "MANAGER",
                cnc_expense_entry: "EXPENSES ENTRY",
              } as Record<string, string>)[profile.role] ?? profile.role.replace(/_/g, " ").toUpperCase()}
            </span>
            <TopbarRefreshButton />
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
      {/* Daksh May 2026 — bottom MobileNav removed. The sidebar now
          renders a hamburger trigger on mobile (sidebar.tsx) so all
          navigation lives in the slide-in drawer. */}
      {/* System-wide tablet keyboard — renders nothing on laptops/desktops;
          on touch tablets it docks a QWERTY + number pad for every text
          field (slab codes, dimensions, temple). */}
      <TabletKeyboardProvider templeCodes={tabletTempleCodes} />
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
  rejectedBillsBadge: number | null;
  inventoryAuditBadge: number | null;
  finalAuditBadge: number | null;
  royaltyApprovalBadge: number | null;
  awaitingReviewBadge: number | null;
  /** Mig 132 — pending slab cancel requests awaiting the owner's verdict.
   *  Owner / developer only; null otherwise. */
  slabCancelBadge: number | null;
  /** Mig 085 — pending debit settlements awaiting owner approval.
   *  Owner / developer only; null otherwise. */
  debitApprovalBadge: number | null;
  /** Mig 090 — pending bank-decline requests awaiting owner approval.
   *  Owner / developer only; null otherwise. */
  bankDeclineBadge: number | null;
  /** Mig 098 — outsource work orders awaiting owner price approval.
   *  Owner / developer only; null otherwise. */
  workOrderApprovalBadge: number | null;
  /** Mig 118 — carving slabs escalated to the owner during approval.
   *  Owner / developer only; null otherwise. */
  ownerReviewBadge: number | null;
  slabImportBadge: number | null;
  /** Provisional dispatches awaiting a senior's approval before the truck
   *  leaves. Owner / developer / carving_head / senior_incharge; null otherwise. */
  dispatchApprovalBadge: number | null;
  /** Mig 167 — priced challans awaiting the OWNER's invoice approval.
   *  Owner / developer only; null otherwise. */
  invoiceApprovalBadge: number | null;
}): TopbarTask[] {
  const items: TopbarTask[] = [];
  // Mig 058 follow-on (Daksh) — per-user rejected-bills item.
  // Pushed FIRST so the accountant sees their own action items at
  // the top of the dropdown, ahead of org-wide queues like
  // Crosscheck / Pay Today. Pushed EVEN WHEN count is 0 — Daksh
  // wants the Tasks pill always visible for accountants so they
  // know the surface exists (TopbarTasksBadge hides itself when
  // items.length === 0; one zero-count row keeps the pill alive
  // and shows "All clear" most of the time, "Tasks N" when a
  // rejection lands).
  if (counts.rejectedBillsBadge !== null) {
    items.push({
      id: "rejected-bills",
      href: "/accounts/bills?status=rejected",
      label: "Rejected bills",
      description: "Your submissions sent back at crosscheck — edit and resubmit",
      count: counts.rejectedBillsBadge,
      icon: "↺",
      department: "finance",
    });
  }
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
  // Daksh May 2026 round 2 — "Carving Done Approval" queue (Mig 076
  // rename — was "Awaiting Review" but Daksh found that name
  // confusing; the slabs aren't awaiting anything, the carving is
  // done and needs sign-off). Server query key stays ?tab=review
  // so any bookmarked URLs keep working. Audience: owner / developer
  // / carving_head / senior_incharge — excludes can_assign_carving
  // holders (they don't sign off on their own work).
  if (counts.awaitingReviewBadge !== null) {
    items.push({
      id: "awaiting-review",
      href: "/carving?tab=review",
      label: "Carving Done Approval",
      description: "Completed carvings awaiting sign-off",
      count: counts.awaitingReviewBadge,
      icon: "🎨",
      department: "production",
    });
  }
  // Mig 132 — Slab Cancel Requests. Broken slabs flagged by the team;
  // the owner approves (slab exits) or rejects (slab stays). Owner /
  // developer only.
  if (counts.slabCancelBadge !== null) {
    items.push({
      id: "slab-cancels",
      href: "/tasks/slab-cancels",
      label: "Slab Cancel Requests",
      description: "Broken slabs awaiting your approve / reject",
      count: counts.slabCancelBadge,
      icon: "🚫",
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
  // Mig 085 — Debit approval (owner / developer only). Flagged
  // overpayments the auditor settled with a debit, waiting for the
  // owner's sign-off before the chosen bill's outstanding drops.
  // Links to /accounts/approvals where the "Debit approvals" section
  // lives at the top.
  if (counts.debitApprovalBadge !== null) {
    items.push({
      id: "debit-approval",
      href: "/accounts/approvals",
      label: "Debit approval",
      description: "Overpayment debits awaiting your sign-off",
      count: counts.debitApprovalBadge,
      icon: "⇄",
      department: "finance",
    });
  }
  // Mig 090 — Bank Decline approval (owner / developer only). The
  // accountant flagged a downloaded payment as refused by the bank;
  // approving it sends the bill back to due.
  if (counts.bankDeclineBadge !== null) {
    items.push({
      id: "bank-decline-approval",
      href: "/accounts/bank-declines",
      label: "Bank Declines",
      description: "Bank-declined payments awaiting your approval",
      count: counts.bankDeclineBadge,
      icon: "🏦",
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
  // Mig 064 — Royalty Approval (owner / developer only). Non-owner
  // royalty entries land here for owner sign-off before counting
  // toward each vendor's net balance. Gated by an extra passphrase
  // (125500) on the page itself.
  if (counts.royaltyApprovalBadge !== null) {
    items.push({
      id: "royalty-approval",
      href: "/accounts/royalty-approvals",
      label: "Royalty Approval",
      description: "Pending royalty entries awaiting your sign-off",
      count: counts.royaltyApprovalBadge,
      icon: "🏷️",
      department: "finance",
    });
  }
  // Mig 098 — Outsource Work Order price approval (owner / developer only).
  if (counts.workOrderApprovalBadge !== null) {
    items.push({
      id: "work-order-approval",
      href: "/carving?mode=outsource&tab=workorders",
      label: "Work Order Approvals",
      description: "Outsource work orders awaiting your price approval",
      count: counts.workOrderApprovalBadge,
      icon: "🏭",
      department: "production",
    });
  }
  // Dispatch Approval — provisional dispatches awaiting a senior's sign-off
  // before the truck leaves. Owner / developer / carving_head / senior_incharge.
  if (counts.dispatchApprovalBadge !== null) {
    items.push({
      id: "dispatch-approval",
      href: "/dispatch?tab=provisional",
      label: "Dispatch Approval",
      description: "Dispatches waiting for your approval before the truck leaves",
      count: counts.dispatchApprovalBadge,
      icon: "🚚",
      department: "production",
    });
  }
  // Mig 167 — Invoice approval (OWNER): priced challans waiting for your final
  // sign-off before they become invoices and the truck is released.
  if (counts.invoiceApprovalBadge !== null) {
    items.push({
      id: "invoice-approval",
      href: "/invoicing/approval",
      label: "Invoice Approval",
      description: "Priced challans waiting for your approval to issue the invoice",
      count: counts.invoiceApprovalBadge,
      icon: "🧾",
      department: "finance",
    });
  }
  // Mig 118 — slabs flagged to the owner during Carving Done Approval.
  if (counts.ownerReviewBadge !== null) {
    items.push({
      id: "owner-reviews",
      href: "/tasks/owner-reviews",
      label: "Owner Review",
      description: "Carving slabs flagged to you during approval",
      count: counts.ownerReviewBadge,
      icon: "👤",
      department: "production",
    });
  }
  // Mig 122 — Excel slab-import batches awaiting approval.
  if (counts.slabImportBadge !== null) {
    items.push({
      id: "slab-imports",
      href: "/tasks/slab-imports",
      label: "Slab Import Approvals",
      description: "Excel import batches waiting for your approval",
      count: counts.slabImportBadge,
      icon: "🗂",
      department: "production",
    });
  }
  return items;
}
