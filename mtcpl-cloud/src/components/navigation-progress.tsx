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
// ── When it STOPS, and why that was wrong ────────────────────────
//
// It clears when usePathname()/useSearchParams() change — i.e. a real
// navigation finished — or on a safety timeout.
//
// That is fine for a link. It is WRONG for a server action, which is
// most of what this app does: an action re-renders the page in place
// and changes neither the path nor the query, so there is no signal
// here at all and the bar ran until the timeout. Dispatch made it
// obvious — Daksh, Oct 2026: "the page opens but the top loading bar
// still doesn't get off, and that spinning arrow doesn't stop until
// very long… meanwhile it works, we are still able to go for any new
// request."
//
// That last clause is the whole diagnosis: the app was never busy. The
// indicator was lying, and it was lying for 90 SECONDS because the
// safety timeout had been widened from 12s to 90s to stop the bar
// vanishing mid-navigation on the slow Dispatch page. That fixed one
// complaint by making this one six times worse.
//
// Three things now end it, so the timeout is a backstop again:
//
//   1. A real navigation (path/query change) — as before.
//   2. The user touching the page again. A screen that accepts a click
//      is not blocked, so the bar has no business still being up. This
//      is the signal that matches what Daksh actually observed.
//   3. A timeout sized to the KIND of work: a navigation may legitimately
//      take a while on a plant tablet, a server action that re-renders
//      in place should not. A form submit no longer inherits the long
//      navigation budget.
//
// Designed to be near-zero cost on idle pages: just two listeners
// and a re-render only when the active state toggles.
// ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** A navigation may genuinely take a while on a plant tablet over yard
 *  wifi, so it keeps a long backstop. */
const NAV_BUDGET_MS = 30_000;
/** A server action re-renders in place; if it has not finished in this
 *  long, the bar is almost certainly stuck rather than busy. */
const ACTION_BUDGET_MS = 6_000;
/** Grace before the user's own interaction is allowed to clear the bar,
 *  so the click that raised it cannot immediately cancel it. */
const RELEASE_AFTER_MS = 900;

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    /** When the current indicator went up — used so the "user touched
     *  the page" release cannot kill the bar on the same click that
     *  raised it. */
    let shownAt = 0;

    function startSoon(budgetMs: number) {
      // Tiny delay so navigations that finish in < 60ms never
      // flicker the bar. Cut from 100ms → 60ms after Daksh
      // flagged the cursor change felt late.
      if (showTimer) clearTimeout(showTimer);
      shownAt = Date.now();
      showTimer = setTimeout(() => setActive(true), 60);
      // Backstop only. The real stops are a route change and the
      // user's next interaction (see below); this just guarantees the
      // bar cannot outlive the work by more than its own budget.
      if (safetyTimer) clearTimeout(safetyTimer);
      safetyTimer = setTimeout(stop, budgetMs);
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
      startSoon(NAV_BUDGET_MS);
    }

    function onSubmit(e: SubmitEvent) {
      // Skip forms that explicitly disabled the indicator (e.g. the
      // GSTIN lookup form should be silent).
      const form = e.target as HTMLFormElement | null;
      if (form?.dataset.noProgress === "1") return;
      // A server action re-renders in place and gives us no completion
      // signal, so it gets a short budget. The button that was pressed
      // shows its own "Saving…" state for anything longer — a global
      // bar adds nothing there except doubt.
      startSoon(ACTION_BUDGET_MS);
    }

    /** The page accepting input means the page is not blocked. Ignore
     *  the click that STARTED this (hence the grace window), and the
     *  modifier-less re-click a link gets while it is still resolving. */
    function onInteract() {
      if (Date.now() - shownAt > RELEASE_AFTER_MS) stop();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    // Bubble phase, AFTER onClick's capture pass, so a link click still
    // raises the bar before this can consider releasing it.
    document.addEventListener("pointerdown", onInteract);
    document.addEventListener("keydown", onInteract);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("pointerdown", onInteract);
      document.removeEventListener("keydown", onInteract);
      stop();
    };
  }, []);

  // Pathname OR query string changed → navigation completed → clear.
  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  if (!active) return null;

  return (
    <>
      {/* Daksh refinement: the cursor:wait set on <body> wasn't
          visible until the mouse moved off the clicked button —
          buttons have their own `cursor: pointer` which wins in the
          cascade. Forcing `cursor: wait !important` on EVERY
          element with a universal selector flips the cursor right
          at the click moment, with no mouse-move required. The
          rule only exists while the indicator is active so there's
          no idle-state cost. */}
      <style>{`
        html.mtcpl-nav-loading,
        html.mtcpl-nav-loading *,
        html.mtcpl-nav-loading *::before,
        html.mtcpl-nav-loading *::after {
          cursor: wait !important;
        }
        @keyframes mtcpl-nav-progress {
          0%   { transform: translateX(-100%); }
          55%  { transform: translateX(40%); }
          100% { transform: translateX(220%); }
        }
        @keyframes mtcpl-nav-glow {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
      `}</style>
      <ClassOnHtml className="mtcpl-nav-loading" />
      {/* Daksh: top bar more prominent. Bumped from 3px to 5px,
          dropped the soft gradient ends for a solid bright bar with
          a visible glow that pulses, so it reads as "active" even
          when the slide is between its left/right extremes. */}
      <div
        role="progressbar"
        aria-label="Loading"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          background: "rgba(201, 161, 74, 0.18)",
          zIndex: 9999,
          overflow: "hidden",
          pointerEvents: "none",
          animation: "mtcpl-nav-glow 1.8s ease-in-out infinite",
          boxShadow: "0 0 14px rgba(201, 161, 74, 0.55)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "45%",
            background:
              "linear-gradient(90deg, rgba(201,161,74,0) 0%, #d4ad58 25%, #c9a14a 50%, #a4823a 75%, rgba(164,130,58,0) 100%)",
            animation: "mtcpl-nav-progress 1.1s ease-in-out infinite",
            boxShadow:
              "0 0 18px rgba(201, 161, 74, 0.95), 0 1px 4px rgba(164,130,58,0.6)",
          }}
        />
      </div>
    </>
  );
}

/** Tiny helper that adds a class to <html> while mounted and
 *  removes it on unmount. Decoupled from the cursor logic above so
 *  the className stays scoped to the React lifecycle even if a
 *  parent fast-refreshes. */
function ClassOnHtml({ className }: { className: string }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add(className);
    return () => {
      document.documentElement.classList.remove(className);
    };
  }, [className]);
  return null;
}
