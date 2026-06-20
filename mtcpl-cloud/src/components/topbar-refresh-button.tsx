"use client";

// Manual page reload, sat next to the role pill in the top bar.
//
// Why: on the kiosk-mode tablets the floor staff use, browser pull-to-refresh
// is disabled (it fought with normal scrolling) — which left no way to reload
// when a screen goes stale. This button is that way: a full reload, exactly
// what pull-to-refresh used to do, on every page for everyone.
export function TopbarRefreshButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="topbar-settings-btn"
      title="Reload this page"
      aria-label="Reload this page"
    >
      ⟳
    </button>
  );
}
