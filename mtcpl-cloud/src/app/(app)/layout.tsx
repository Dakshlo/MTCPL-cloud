import type { ReactNode } from "react";
import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { MobileNav } from "@/components/mobile-nav";
import { NotificationBell } from "@/components/notification-bell";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { Heartbeat } from "@/components/heartbeat";
import { requireAuth } from "@/lib/auth";
import { canApproveCuts } from "@/lib/cutting-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const SETTINGS_ROLES = ["developer", "owner", "team_head"];
const NOTIFICATION_ROLES = ["developer"]; // flip to include "team_head" at rollout

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";

  // Cut-approval queue size — only loaded for approvers (migration 027).
  // Cheap single-COUNT query, indexed by the partial index added in 027.
  // The badge updates on next page load; RealtimeRefresh keeps it
  // fresh on navigation across the shell.
  let approvalsBadge: number | null = null;
  if (canApproveCuts(profile)) {
    const supabase = createAdminSupabaseClient();
    const { count } = await supabase
      .from("cut_session_blocks")
      .select("*", { count: "exact", head: true })
      .in("status", ["awaiting_approval", "awaiting_cutter_edit"]);
    approvalsBadge = count ?? 0;
  }

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Heartbeat />
      <Sidebar
        displayName={displayName}
        role={profile.role}
        themePreference={profile.theme_preference ?? null}
      />

      <main className="main-shell">
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
            {/* Cut-approval queue button — visible only to approvers
                (canApproveCuts: developer / owner / team_head with
                can_approve_cuts=TRUE). Migration 027.
                Sits BETWEEN the user name (top-bar-left) and the role
                pill so approvers see their queue size at a glance.
                Red dot when count > 0, mirroring the notification bell. */}
            {approvalsBadge !== null && (
              <Link
                href="/cutting/approvals"
                title={
                  approvalsBadge > 0
                    ? `${approvalsBadge} block${approvalsBadge === 1 ? "" : "s"} waiting for approval`
                    : "Cutting approvals queue (empty)"
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
                ✓ Approvals
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
