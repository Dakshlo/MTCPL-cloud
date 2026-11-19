"use client";

// ──────────────────────────────────────────────────────────────────
// When the cupboard screen fails, say so IN THE CUPBOARD'S VOICE.
//
// Daksh, Nov 2026, for the second time: "it's kicking me again and
// again from the phone inventory, that this page couldn't load."
//
// Until now there was no error boundary anywhere under /guest. The
// (app) tree has had one for months; this tree — the one used by men
// who are not logged in, on their own phones, standing at a wardrobe
// — had none. So anything that threw while the page was being built
// went out as a bare 500, and what the man got was whatever his
// browser draws for a page that did not arrive. No reason, and worse,
// no way back except typing the address again or re-scanning the
// sticker, neither of which he is going to do with his hands full.
//
// This screen does three things that the browser's cannot:
//
//   1. a TRY AGAIN button, which re-renders without a fresh page load
//      — the single most useful thing on a flaky shed connection
//   2. says plainly that nothing he did was lost, because the fear
//      after a crash mid-take is that the tool went out of the
//      register without his name on it. It did not: every write here
//      is one statement, and a page that never finished rendering
//      never wrote anything at all
//   3. prints the digest. Next.js strips the real message out of
//      production builds and leaves this hash in its place; it is the
//      only thread back to what actually threw, and it is no use to
//      anybody sitting in a log nobody reads. On the screen, he can
//      photograph it and send it.
//
// It cannot catch a page that never reached the phone — if the
// request itself fails, the browser's own message is all there is.
// That is the point of showing the digest: if he sends THIS screen,
// the fault is ours and traceable. If he sends the browser's, it is
// the connection or the deployment, and we look somewhere else.
// ──────────────────────────────────────────────────────────────────

import { useEffect } from "react";

export default function GuestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to Sentry via the client config, and to the browser console
    // for anybody looking over his shoulder with a laptop.
    console.error("[guest] render failed", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f4f5f7",
        color: "#1a1d22",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 340, width: "100%" }}>
        <div style={{ fontSize: 46, marginBottom: 12 }} aria-hidden>
          🧰
        </div>
        <h1 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 8px" }}>
          This screen did not open
        </h1>
        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "#5c636e",
            margin: "0 0 4px",
          }}
        >
          Nothing you did was lost, and nothing was taken off the shelf in your
          name. Tap below to try again.
        </p>

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 18,
            width: "100%",
            /* 54px: pressed on a shop floor, sometimes with a glove on. */
            minHeight: 54,
            padding: "14px 18px",
            border: "none",
            borderRadius: 12,
            background: "#C9973A",
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Try again
        </button>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 10,
            width: "100%",
            minHeight: 46,
            padding: "12px 18px",
            borderRadius: 12,
            border: "1px solid #d8d2c4",
            background: "transparent",
            color: "#5c636e",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload the page
        </button>

        {error.digest && (
          <p
            style={{
              marginTop: 18,
              fontSize: 11,
              color: "#9aa1ab",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            If it keeps happening, send the office this code:
            <br />
            <span style={{ color: "#5c636e", fontWeight: 700 }}>{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
