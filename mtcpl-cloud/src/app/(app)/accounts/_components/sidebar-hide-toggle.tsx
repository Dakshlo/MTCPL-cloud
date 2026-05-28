"use client";

/**
 * Accounts hide-sidebar toggle (Daksh, May 2026).
 *
 * Modelled on src/app/(app)/inventory/_components/sidebar-hide-toggle.tsx
 * — same body-class mechanism (`inv-hide-sidebar`, which the globals.css
 * rule wires up to collapse the sidebar column). Different storage key
 * so accounts + inventory remember their preferences independently.
 *
 * Why: dad asked for a full-width Due Bills view so he can see every
 * column from Vendor/Token through the Proposed amount in one glance
 * without horizontal scroll. Hides the global navigation sidebar; the
 * Tasks pill, Find ID, and the role chip stay in the topbar.
 *
 * On unmount (navigating away from accounts) the body class is cleared
 * automatically so the sidebar reappears for other departments. When
 * the user comes back to Due Bills, the localStorage value drives the
 * restored state.
 *
 * Hydration: a tiny pre-paint script (SidebarHideHydrationScript)
 * reads localStorage and applies the body class BEFORE React hydrates,
 * so there's no flash of "sidebar then no sidebar" on page load.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mtcpl:accounts-hide-sidebar";
const BODY_CLASS = "inv-hide-sidebar";

/** Pre-paint script — runs synchronously before React hydration so
 *  the body class is set early enough to avoid a layout flash. */
export function AccountsSidebarHideHydrationScript() {
  const code = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY,
  )});if(v==="1")document.body.classList.add(${JSON.stringify(BODY_CLASS)});}catch(_){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export function AccountsSidebarHideToggle() {
  const [hidden, setHidden] = useState<boolean | null>(null);

  // Sync from localStorage on mount.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      setHidden(v === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  // Apply / remove body class whenever hidden flips. Cleanup runs on
  // unmount → sidebar comes back when the user leaves Due Bills.
  useEffect(() => {
    if (hidden === null) return;
    document.body.classList.toggle(BODY_CLASS, hidden);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [hidden]);

  const toggle = useCallback(() => {
    setHidden((cur) => {
      const next = !cur;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Private mode etc. — fall through, the session-level flip
        // still works.
      }
      return next;
    });
  }, []);

  const isHidden = hidden === true;
  const label = isHidden ? "Show menu" : "Hide menu";
  const icon = isHidden ? "▸" : "◂";
  const title = isHidden
    ? "Show the global navigation sidebar"
    : "Hide the sidebar to see the full Due Bills table edge-to-edge";

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      aria-pressed={isHidden}
      style={{
        padding: "7px 12px",
        fontSize: 12,
        fontWeight: 700,
        background: isHidden ? "var(--gold)" : "var(--surface)",
        color: isHidden ? "#fff" : "var(--text)",
        border: `1px solid ${isHidden ? "var(--gold-dark)" : "var(--border)"}`,
        borderRadius: 8,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        boxShadow: isHidden
          ? "inset 0 1px 0 rgba(255,255,255,0.10)"
          : "0 1px 0 rgba(15, 23, 42, 0.04)",
        transition: "background 0.12s ease, color 0.12s ease",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ opacity: 0.85, fontSize: 13, lineHeight: 1 }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
