"use client";

// ──────────────────────────────────────────────────────────────────
// Global navigation + action loading indicator
// ──────────────────────────────────────────────────────────────────
// Daksh: "when we click any button it takes time to complete the
// task but the user doesn't get feedback that the task is in
// progress. Maybe give a loading ring on the mouse arrow so they
// know something is carrying out."
//
// Two visual cues:
//   1. A thin animated stripe across the top of the viewport.
//      Indeterminate (we don't know when nav will finish) — slides
//      back and forth.
//   2. cursor: wait on the <body> so the mouse arrow itself shows
//      busy state.
//
// Triggers:
//   • Clicks on internal <a href="..."> links (Next.js navigation).
//   • Form submissions.
//
// Resets when usePathname() changes (= navigation has completed) or
// after a 12s safety timeout in case a server action drags + nothing
// changes routes.
//
// Designed to be near-zero cost on idle pages: just two listeners
// and a re-render only when the active state toggles.
// ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    function startSoon() {
      // Tiny delay so navigations that finish in < 100ms never
      // flicker the bar. SPA route changes commonly complete in
      // 60–80ms, so the bar only shows when there's a real wait.
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        setActive(true);
        if (typeof document !== "undefined") {
          document.body.style.cursor = "wait";
        }
      }, 100);
      // Safety net: never leave the indicator hung past 12s.
      if (safetyTimer) clearTimeout(safetyTimer);
      safetyTimer = setTimeout(stop, 12_000);
    }

    function stop() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      setActive(false);
      if (typeof document !== "undefined") {
        document.body.style.cursor = "";
      }
    }

    function onClick(e: MouseEvent) {
      // Skip if any modifier — Cmd/Ctrl-click opens a new tab; we
      // don't want to flash the indicator on the current tab.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // Ignore anchor jumps, mail / tel, and explicit new-tab links.
      const rawHref = anchor.getAttribute("href") ?? "";
      if (
        rawHref.startsWith("#") ||
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("tel:") ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      // Only react to same-origin navigations that actually change
      // the URL. Same-route hash/query no-ops shouldn't flash.
      try {
        const dest = new URL(anchor.href, window.location.origin);
        if (dest.origin !== window.location.origin) return;
        if (
          dest.pathname === window.location.pathname &&
          dest.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      startSoon();
    }

    function onSubmit(e: SubmitEvent) {
      // Skip forms that explicitly disabled the indicator (e.g. the
      // GSTIN lookup form should be silent).
      const form = e.target as HTMLFormElement | null;
      if (form?.dataset.noProgress === "1") return;
      startSoon();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      stop();
    };
  }, []);

  // Pathname OR query string changed → navigation completed → clear.
  useEffect(() => {
    setActive(false);
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  }, [pathname, searchParams]);

  if (!active) return null;

  return (
    <>
      <style>{`
        @keyframes mtcpl-nav-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(20%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
      <div
        role="progressbar"
        aria-label="Loading"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: "transparent",
          zIndex: 9999,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "50%",
            background:
              "linear-gradient(90deg, transparent 0%, var(--gold, #c9a14a) 30%, var(--gold-dark, #a4823a) 70%, transparent 100%)",
            animation: "mtcpl-nav-progress 1.1s ease-in-out infinite",
            boxShadow: "0 1px 8px rgba(201, 161, 74, 0.5)",
          }}
        />
      </div>
    </>
  );
}
