"use client";

/**
 * Light/dark theme switcher. Reads/writes `data-theme` on <html> and
 * persists the choice to localStorage under `mtcpl_theme`.
 *
 * The initial value is set BEFORE React hydrates via an inline script
 * in src/app/layout.tsx — that prevents flash-of-wrong-theme on first
 * paint. This component just keeps state in sync afterwards and
 * provides the click-to-toggle UI inside the sidebar footer.
 */

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Sync state from whatever the pre-hydration script set.
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    setTheme(current === "dark" ? "dark" : "light");
    setMounted(true);
  }, []);

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
