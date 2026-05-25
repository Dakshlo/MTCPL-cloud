"use client";

import { useEffect, useState } from "react";

/**
 * Floating sidebar toggle pinned top-left. Originally lived inside
 * the vendor cockpit so Mohit (carving-head-vendor) could collapse
 * the global sidebar back into focused-cockpit mode and reopen it
 * to reach his other pages. Daksh May 2026 — extracted so Carving
 * Jobs (and any other pages Mohit visits) can mount the same toggle
 * and keep the collapsed-sidebar choice consistent across his
 * navigation.
 *
 * Behaviour:
 *   - Toggles a `vendor-cockpit-fullscreen` class on <body>. The CSS
 *     rule in globals.css collapses the .app-shell grid + hides the
 *     .sidebar when the class is present.
 *   - Persists the expanded/collapsed choice in sessionStorage so it
 *     survives navigation between pages.
 *   - Cleans the class off on unmount so other layouts don't inherit
 *     the collapsed state.
 *
 * `defaultCollapsed` controls the first-visit default (no
 * sessionStorage entry yet). Cockpit passes `true` (focused
 * full-screen feel); pages Mohit lands on via the sidebar pass
 * `false` so the sidebar he just used to navigate stays visible
 * until he taps Hide menu.
 *
 * Mount this on any page where the user should be able to flip the
 * sidebar (currently: /vendor cockpit + /carving for vendor-with-flag).
 */
export function CockpitSidebarToggle({
  defaultCollapsed = true,
}: {
  defaultCollapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean>(!defaultCollapsed);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem(
        "mtcpl_cockpit_sidebar_expanded",
      );
      if (stored === "1") setExpanded(true);
      else if (stored === "0") setExpanded(false);
      // stored === null → keep the prop-driven default
    } catch {
      /* private mode etc — leave default */
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (expanded) {
      document.body.classList.remove("vendor-cockpit-fullscreen");
    } else {
      document.body.classList.add("vendor-cockpit-fullscreen");
    }
    return () => {
      document.body.classList.remove("vendor-cockpit-fullscreen");
    };
  }, [expanded]);

  function toggle() {
    setExpanded((s) => {
      const next = !s;
      try {
        window.sessionStorage.setItem(
          "mtcpl_cockpit_sidebar_expanded",
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={expanded ? "Hide menu" : "Show menu"}
      title={expanded ? "Hide the side menu" : "Show the side menu"}
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 60,
        minWidth: 44,
        height: 44,
        padding: "0 14px",
        borderRadius: 10,
        background: expanded
          ? "rgba(15,12,6,0.75)"
          : "rgba(180,115,51,0.92)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        backdropFilter: "blur(4px)",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        touchAction: "manipulation",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>
        {expanded ? "✕" : "☰"}
      </span>
      <span>{expanded ? "Hide menu" : "Menu"}</span>
    </button>
  );
}
