"use client";

// Root authenticated-area error boundary (Phase 3 of Migration 036).
//
// When a Server Component in the (app) tree throws during render or a
// data fetch, Next.js bubbles up to the nearest error.tsx. Without
// this file the error reached the global app/error.tsx and locked the
// user out of EVERY route — clicking the sidebar wouldn't help, even
// if the navigated-to page was healthy. With this boundary the user
// keeps the sidebar, the top bar, and can navigate away from the
// broken route.
//
// The per-department error.tsx files (accounts/, cutting/, etc.)
// narrow the blast radius further: a /accounts/* failure only takes
// down the Finance pages, not the rest of (app).

import { useEffect } from "react";
import Link from "next/link";

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error-boundary]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "60px auto",
        padding: "32px 28px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: "5px solid #dc2626",
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
        Something went wrong on this page
      </h1>
      <p
        style={{
          margin: "10px 0 0",
          fontSize: 14,
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        The rest of the app — sidebar, other departments and other pages in
        this one — is still working. Try this page again, or jump somewhere
        else.
      </p>
      {/* Sep 2026 — this used to say "The error is logged." It was not
          true: Sentry is wired into the codebase but was never given a
          DSN, so nothing was recorded anywhere, and a floor complaint of
          "an error shows up sometimes" could not be traced to a single
          real error. Until error reporting is switched on (see
          docs/SENTRY_SETUP.md), the reference below is the ONLY handle on
          what went wrong — Next.js hides the message from the browser in
          production and gives out just this digest, which matches a full
          stack trace in the Vercel runtime log. So ask for it plainly
          instead of implying someone is already looking. */}
      {error.digest ? (
        <div
          style={{
            margin: "16px 0 0",
            padding: "12px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            textAlign: "left",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            📷 Please screenshot this and send it to the office
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 15,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              color: "var(--text)",
              wordBreak: "break-all",
            }}
          >
            {error.digest}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
            {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            {" · "}
            {typeof window !== "undefined" ? window.location.pathname : ""}
          </div>
        </div>
      ) : (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
          No error reference was produced — please note what you were doing
          and tell the office.
        </p>
      )}
      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          ↻ Try again
        </button>
        <Link
          href="/dashboard"
          style={{
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--bg)",
            color: "var(--text)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          ← Dashboard
        </Link>
      </div>
    </div>
  );
}
