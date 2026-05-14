import type { ReactNode } from "react";
import Link from "next/link";
import { headers, cookies } from "next/headers";

import { LogoutButton } from "@/components/logout-button";
import { MobileNav } from "@/components/mobile-nav";
import { NotificationBell } from "@/components/notification-bell";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { Heartbeat } from "@/components/heartbeat";
import { requireAuth } from "@/lib/auth";
import { canApproveCuts } from "@/lib/cutting-permissions";
import { canApproveBills } from "@/lib/accounts-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getEffectiveStatus, getDepartmentStatus } from "@/lib/system-status";
import {
  DEPARTMENTS,
  canSwitchDepartment,
  departmentForRoute,
  effectiveDepartment,
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

    // Quick-jump to other departments still live. Only relevant for
    // per-department locks (a global lock means every alternative is
    // also locked) AND for users who can switch departments
    // (developer + owner). Cheap 3-row lookup — only happens on the
    // locked-page-load path. We re-query each dept's flag instead of
    // reusing effectiveStatus so the user always sees fresh state.
    let availableDepartments: Array<{
      id: string;
      label: string;
      icon: string;
      href: string;
    }> = [];
    if (
      effectiveStatus.source === "department" &&
      canSwitchDepartment(profile.role)
    ) {
      const otherDepts: Department[] = (["production", "finance", "inventory"] as const).filter(
        (d) => d !== requestDept,
      );
      const statuses = await Promise.all(otherDepts.map((d) => getDepartmentStatus(d)));
      for (let i = 0; i < otherDepts.length; i++) {
        const dId = otherDepts[i];
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
  // sidebar entry instead (the queue is their day-to-day surface;
  // they don't need a count badge competing with their workflow).
  // The top-bar badge is for approvers who need to know when a
  // proposed batch is waiting on their tick.
  if (canApproveBills(profile)) {
    const { count } = await supabase
      .from("bill_payments")
      .select("*", { count: "exact", head: true })
      .in("status", ["proposed", "confirmed"]);
    payTodayBadge = count ?? 0;
  }

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Heartbeat />
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
            {/* Cutting Audit button — visible only to approvers
                (canApproveCuts: developer / owner / team_head Rajesh
                Kumar with can_approve_cuts=TRUE). Migration 027.
                Named "Cutting Audit" per user — the surface where
                an approver audits cutter submissions before they
                commit. Sits BETWEEN the user name (top-bar-left)
                and the role pill. Red dot when count > 0, mirroring
                the notification bell. */}
            {approvalsBadge !== null && (
              <Link
                href="/cutting/approvals"
                title={
                  approvalsBadge > 0
                    ? `${approvalsBadge} block${approvalsBadge === 1 ? "" : "s"} to audit`
                    : "Cutting Audit queue (empty)"
                }
                style={{
                  position: "relative",
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "5px 12px",
                  background: approvalsBadge > 0 ? "var(--gold)" : "var(--bg)",
                  color: approvalsBadge > 0 ? "#fff" : "var(--text)",
                  border: `1px solid ${approvalsBadge > 0 ? "var(--gold-dark)" : "var(--border)"}`,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                ✓ Cutting Audit
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    padding: "0 6px",
                    borderRadius: 10,
                    background:
                      approvalsBadge > 0
                        ? "rgba(255,255,255,0.25)"
                        : "var(--border)",
                    color: approvalsBadge > 0 ? "#fff" : "var(--muted)",
                    minWidth: 18,
                    textAlign: "center",
                  }}
                >
                  {approvalsBadge}
                </span>
                {approvalsBadge > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -3,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#dc2626",
                      border: "1.5px solid var(--surface, #fff)",
                    }}
                  />
                )}
              </Link>
            )}

            {/* Bills Audit badge — migration 028. Approvers (dev / owner /
                profile.can_approve_bills) see pending bill submissions to
                review. */}
            {billsAuditBadge !== null && (
              <TopbarBadge
                href="/accounts/approvals"
                label="₹ Bills Audit"
                count={billsAuditBadge}
                emptyTitle="Bills Audit queue (empty)"
                activeTitle={`${billsAuditBadge} bill${billsAuditBadge === 1 ? "" : "s"} to audit`}
              />
            )}

            {/* Pay Today badge — migration 028. Accountant + owner + dev
                see in-flight payment proposals + confirmed-ready-to-pay
                rows. Click → /accounts/pay-today. */}
            {payTodayBadge !== null && (
              <TopbarBadge
                href="/accounts/pay-today"
                label="💸 Pay Today"
                count={payTodayBadge}
                emptyTitle="Pay Today queue (empty)"
                activeTitle={`${payTodayBadge} payment${payTodayBadge === 1 ? "" : "s"} in flight`}
              />
            )}

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

/** Topbar action badge — same visual treatment as the Cutting Audit
 *  button above. Extracted because Bills Audit + Pay Today share it
 *  one-for-one. */
function TopbarBadge({
  href,
  label,
  count,
  emptyTitle,
  activeTitle,
}: {
  href: string;
  label: string;
  count: number;
  emptyTitle: string;
  activeTitle: string;
}) {
  const active = count > 0;
  return (
    <Link
      href={href}
      title={active ? activeTitle : emptyTitle}
      style={{
        position: "relative",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 700,
        padding: "5px 12px",
        background: active ? "var(--gold)" : "var(--bg)",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <span
        style={{
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          fontWeight: 700,
          padding: "0 6px",
          borderRadius: 10,
          background: active ? "rgba(255,255,255,0.25)" : "var(--border)",
          color: active ? "#fff" : "var(--muted)",
          minWidth: 18,
          textAlign: "center",
        }}
      >
        {count}
      </span>
      {active && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#dc2626",
            border: "1.5px solid var(--surface, #fff)",
          }}
        />
      )}
    </Link>
  );
}
