// ──────────────────────────────────────────────────────────────────
// Shared page skeleton for every screen in the (app) group.
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Sep 2026: "they are not able to open the dispatch page — all
// pages are opening but when they press on dispatch it loads and
// nothing happens."
//
// It was opening. There was just nothing on screen to say so. Without
// a loading boundary, Next holds the OLD page in place for the whole
// server render plus transfer, so a click on a heavy route looks like
// a click that did nothing. Dispatch ships ~1.2 MB and is the slowest
// of them, so it is the one that got reported — but every page in the
// app behaved this way, which is most of what "overall performance is
// slow" actually felt like. The work was not slower than the numbers
// said; the app just never admitted it was working.
//
// This file is the fix. Next swaps it in the instant a navigation
// starts, so the screen changes immediately and the real page streams
// in behind it. One file at the group root covers every page inside.
//
// Deliberately a shape, not a spinner: a title bar, a row of stat
// tiles and some cards is what most screens in here actually look
// like, so the layout does not jump when the real content lands.
// Nothing here fetches, imports or measures anything — it has to be
// the cheapest thing in the app or it defeats its own purpose.

const SHIMMER = "mtcpl-skel";

function Bar({ w, h = 14, r = 6 }: { w: string | number; h?: number; r?: number }) {
  return <div className={SHIMMER} style={{ width: w, height: h, borderRadius: r }} />;
}

function Card({ lines = 3 }: { lines?: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Bar w="55%" h={16} />
      {Array.from({ length: lines }).map((_, i) => (
        <Bar key={i} w={`${85 - i * 15}%`} h={11} />
      ))}
    </div>
  );
}

export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`
        @keyframes mtcpl-skel-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        .${SHIMMER} {
          background: var(--border-light);
          animation: mtcpl-skel-pulse 1.3s ease-in-out infinite;
        }
        /* A wall TV or a tablet left on this screen should not strobe. */
        @media (prefers-reduced-motion: reduce) {
          .${SHIMMER} { animation: none; opacity: 0.7; }
        }
      `}</style>

      {/* Page title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Bar w={260} h={26} r={7} />
        <Bar w={360} h={12} />
      </div>

      {/* Stat / tab strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} w={150} h={38} r={999} />
        ))}
      </div>

      {/* Content cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} lines={i % 2 === 0 ? 3 : 2} />
        ))}
      </div>

      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Loading…</span>
    </div>
  );
}
