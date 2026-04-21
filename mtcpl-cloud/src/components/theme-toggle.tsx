"use client";

/**
 * Light/dark theme switcher — persists to BOTH localStorage AND the
 * user's profile row so the choice travels across devices.
 *
 * Flow on any page load:
 *   1. Root layout's inline script reads localStorage and applies
 *      data-theme BEFORE React paints (prevents FOUC).
 *   2. (app) layout fetches profile.theme_preference server-side and
 *      passes it in as `initialFromDB`.
 *   3. On mount here, if DB disagrees with current <html data-theme>,
 *      the DB wins — which matters when the user logs in on a fresh
 *      browser where localStorage is empty.
 *   4. On click, we update <html>, localStorage, AND fire a server
 *      action to write back to profiles.theme_preference so the choice
 *      survives for the next device / next login.
 *
 * Default is always light (root layout ignores OS prefers-color-scheme
 * on purpose — the user asked for that).
 */

import { useEffect, useState } from "react";
import { updateThemePreferenceAction } from "@/lib/theme-actions";

type Theme = "light" | "dark";

export function ThemeToggle({ initialFromDB }: { initialFromDB: Theme | null }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // What the inline script set (from localStorage) at first paint:
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    const localTheme: Theme = current === "dark" ? "dark" : "light";

    // DB wins when available — applies to fresh-browser first-login.
    // If DB says dark but localStorage was empty/light, flip the page
    // to dark so the user's saved preference applies before they even
    // interact with the toggle.
    if (initialFromDB && initialFromDB !== localTheme) {
      if (initialFromDB === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      try {
        localStorage.setItem("mtcpl_theme", initialFromDB);
      } catch {}
      setTheme(initialFromDB);
    } else {
      setTheme(localTheme);
    }

    setMounted(true);
  }, [initialFromDB]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem("mtcpl_theme", next);
    } catch {
      // localStorage can fail in private mode — theme still works for the session.
    }
    // Fire-and-forget: persist to DB so the choice is remembered
    // across devices. Errors are logged but not surfaced (the local
    // change already took effect; DB sync can retry on next toggle).
    updateThemePreferenceAction(next).catch((e) => {
      console.warn("[theme] DB sync failed:", e);
    });
  }

  // Render a placeholder while waiting for hydration so the button text
  // doesn't flip on first frame.
  if (!mounted) {
    return (
      <button className="theme-toggle" aria-hidden="true" tabIndex={-1} style={{ opacity: 0.5 }}>
        <span>◐</span>
        <span>Theme</span>
      </button>
    );
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span style={{ fontSize: 15 }}>{theme === "dark" ? "☀" : "☾"}</span>
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
