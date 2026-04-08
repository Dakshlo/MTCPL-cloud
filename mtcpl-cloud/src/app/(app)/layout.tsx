import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { LanguageToggle } from "@/components/language-toggle";
import { LogoutButton } from "@/components/logout-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Sidebar } from "@/components/sidebar";
import { Toast } from "@/components/toast";
import { requireAuth } from "@/lib/auth";
import { getLanguage, t } from "@/lib/i18n";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth();
  const cookieStore = await cookies();
  const lang = getLanguage(cookieStore.get("mc_lang")?.value);
  const displayName = profile.vendor_name || profile.full_name || profile.phone || "MTCPL User";
  const roleLabel = profile.role === "vendor" ? profile.vendor_name || t(lang, "vendor") : t(lang, profile.role);

  return (
    <div className="app-shell">
      <RealtimeRefresh />
      <Sidebar displayName={displayName} role={profile.role} lang={lang} />

      <main className="main-shell">
        <div className="topbar">
          <div>
            <div className="muted">{t(lang, "signedIn")}</div>
            <strong>{displayName}</strong>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted">{t(lang, "language")}</span>
              <LanguageToggle lang={lang} />
            </div>
            <span className="role-pill">{t(lang, "portal")}: {roleLabel}</span>
            <LogoutButton lang={lang} />
          </div>
        </div>

        {children}
      </main>
      <Toast />
    </div>
  );
}
