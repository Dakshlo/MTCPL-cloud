import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";
  const roleLabel = profile.role === "vendor" ? profile.vendor_name || "Vendor" : profile.role;

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Sidebar displayName={displayName} role={profile.role} />

      <main className="main-shell">
        <div className="topbar">
          <div>
            <div className="muted">Signed in</div>
            <strong>{displayName}</strong>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="role-pill">Portal: {roleLabel}</span>
            <LogoutButton />
          </div>
        </div>

        {children}
      </main>
      <Toast />
    </div>
  );
}
