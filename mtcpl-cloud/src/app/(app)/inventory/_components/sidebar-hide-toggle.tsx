"use client";

/**
 * Inventory-only sidebar hide toggle (Daksh, May 2026).
 *
 * Adds/removes `body.inv-hide-sidebar` which the globals.css rule
 * picks up to collapse the global sidebar's grid column and hide
 * the sidebar itself. Persisted in localStorage so the storekeeper's
 * preference sticks across reloads and across inventory sub-pages.
 *
 * On unmount (navigating away from inventory) the class is cleared
 * so the sidebar reappears for other departments. The user can
 * still toggle it back when they return — the localStorage value
 * is what we restore from.
 *
 * Hydration: a tiny pre-paint script reads localStorage and applies
 * the class BEFORE React hydrates, so the storekeeper doesn't see a
 * flash of "sidebar then no sidebar" on first paint when their
 * preference was hidden. The script is idempotent and harmless on
 * non-inventory routes (the class is removed by this component's
 * cleanup if it ever ends up there).
 */

import { useCallback, useEffect, useState } from "react";
import { INV_THEME } from "./theme";

const STORAGE_KEY = "mtcpl:inv-hide-sidebar";
const BODY_CLASS = "inv-hide-sidebar";

/** Pre-paint script. Runs synchronously in the document before
 *  React hydration so the body class is set early enough to avoid
 *  a layout flash. Safe to include on every inventory page render —
 *  reading localStorage is fast and the class set is idempotent. */
export function SidebarHideHydrationScript() {
  // We use dangerouslySetInnerHTML so the script content is
  // serialised verbatim into the HTML stream (no React wrapping).
  // The IIFE catches any storage exceptions silently — private-mode
  // browsers etc.
  const code = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY,
  )});if(v==="1")document.body.classList.add(${JSON.stringify(
    BODY_CLASS,
  )});}catch(_){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export function SidebarHideToggle() {
  // null = haven't read localStorage yet (server render + first
  // client paint). Once we know, render the proper label. Until then
  // we render the visible-state label optimistically; the
  // hydration-script handles the flash for users whose preference
  // is hidden.
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

  // Apply the body class whenever `hidden` flips. The cleanup runs
  // on unmount → the sidebar comes back when the user navigates
  // away from the inventory shell.
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
        // localStorage blocked (private mode) — we still flip the
        // in-memory state so the current session works.
      }
      return next;
    });
  }, []);

  const isHidden = hidden === true;
  const label = isHidden ? "Show menu" : "Hide menu";
  const icon = isHidden ? "▸" : "◂";
  const title = isHidden
    ? "Show the global navigation sidebar"
    : "Hide the global navigation sidebar to free up width on this page";

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
        background: isHidden ? INV_THEME.steel : INV_THEME.paper,
        color: isHidden ? "#fff" : INV_THEME.steel,
        border: `1px solid ${isHidden ? INV_THEME.steelDark : INV_THEME.parchment}`,
        borderRadius: 8,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        boxShadow: isHidden
          ? "inset 0 1px 0 rgba(255,255,255,0.08)"
          : "0 1px 0 rgba(28, 52, 69, 0.04)",
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
