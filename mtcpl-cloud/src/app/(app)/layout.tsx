import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { MobileNav } from "@/components/mobile-nav";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { Heartbeat } from "@/components/heartbeat";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Heartbeat />
      <Sidebar displayName={displayName} role={profile.role} />

      <main className="main-shell">
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-label">Signed in as</span>
            <strong className="topbar-name">{displayName}</strong>
          </div>
          <div className="topbar-right">
            <span className="role-pill" style={
              profile.role === "developer" ? { background: "var(--gold)", color: "#fff", fontWeight: 700 } :
              profile.role === "owner"     ? { background: "#1a1a1a", color: "#fff", fontWeight: 700 } :
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
            <LogoutButton />
          </div>
        </div>

        <div className="page-content">
          {children}
        </div>
      </main>
      <MobileNav role={profile.role} />
      <Toast />
    </div>
  );
}
