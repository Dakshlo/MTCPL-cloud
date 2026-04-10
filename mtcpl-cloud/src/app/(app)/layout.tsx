import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Sidebar displayName={displayName} role={profile.role} />

      <main className="main-shell">
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-label">Signed in as</span>
            <strong className="topbar-name">{displayName}</strong>
          </div>
          <div className="topbar-right">
            <span className="role-pill">{profile.role.replace("_", " ")}</span>
            <LogoutButton />
          </div>
        </header>

        <div className="page-content">
          {children}
        </div>
      </main>
      <Toast />
    </div>
  );
}
