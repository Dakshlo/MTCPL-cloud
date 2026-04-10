import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { requireAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const lang = "en";
  const displayName = profile.full_name || profile.phone || "MTCPL User";

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Sidebar displayName={displayName} role={profile.role} lang={lang} />

      <main className="main-shell">
        <header className="topbar">
          <PageHeader />
          <div className="topbar-actions">
            <div className="topbar-user">
              <span className="muted">{t(lang, "signedIn")}</span>
              <strong>{displayName}</strong>
              <span className="status-badge">{t(lang, profile.role)}</span>
            </div>
            <LogoutButton lang={lang} />
          </div>
        </header>

        <div className="page-content">{children}</div>
      </main>
      <Toast />
    </div>
  );
}
