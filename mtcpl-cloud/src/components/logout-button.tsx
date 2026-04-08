"use client";

import { useRouter } from "next/navigation";

import type { Language } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function LogoutButton({ lang }: { lang: Language }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button className="secondary-button" onClick={handleLogout} type="button">
      {t(lang, "signOut")}
    </button>
  );
}
