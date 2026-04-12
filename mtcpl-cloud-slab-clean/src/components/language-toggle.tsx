"use client";

import { useRouter } from "next/navigation";

import type { Language } from "@/lib/i18n";

export function LanguageToggle({ lang }: { lang: Language }) {
  const router = useRouter();

  function setLang(nextLang: Language) {
    document.cookie = `mc_lang=${nextLang}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="language-toggle" role="group" aria-label="Language toggle">
      <button
        className={lang === "en" ? "language-button language-button-active" : "language-button"}
        onClick={() => setLang("en")}
        type="button"
      >
        EN
      </button>
      <button
        className={lang === "hi" ? "language-button language-button-active" : "language-button"}
        onClick={() => setLang("hi")}
        type="button"
      >
        हिं
      </button>
    </div>
  );
}
