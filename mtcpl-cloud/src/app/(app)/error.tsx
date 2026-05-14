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
        The error is logged. The rest of the app — sidebar, other departments
        and other pages in this one — is still working. You can try this
        page again, or jump somewhere else.
      </p>
      {error.digest && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            color: "var(--muted)",
          }}
        >
          Error reference: <strong>{error.digest}</strong>
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
