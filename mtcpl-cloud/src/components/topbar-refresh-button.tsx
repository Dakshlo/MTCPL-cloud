"use client";

import { useState } from "react";

// Manual page reload, sat next to the role pill in the top bar.
//
// Why: on the kiosk-mode tablets the floor staff use, browser pull-to-refresh
// is disabled (it fought with normal scrolling) — which left no way to reload
// when a screen goes stale. This button is that way: a full reload, exactly
// what pull-to-refresh used to do, on every page for everyone.
//
// On tap it spins immediately (a tiny delay lets the spin paint before the
// reload tears the page down) so the user gets feedback that it IS refreshing.
export function TopbarRefreshButton() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <style>{`@keyframes mtcpl-refresh-spin{to{transform:rotate(360deg)}}`}</style>
      <button
        type="button"
        onClick={() => {
          if (busy) return;
          setBusy(true);
          setTimeout(() => window.location.reload(), 90);
        }}
        className="topbar-settings-btn"
        title="Reload this page"
        aria-label="Reload this page"
        aria-busy={busy}
        style={{ cursor: busy ? "wait" : undefined }}
      >
        <span
          style={{
            display: "inline-block",
            animation: busy ? "mtcpl-refresh-spin 0.7s linear infinite" : undefined,
          }}
        >
          ⟳
        </span>
      </button>
    </>
  );
}
