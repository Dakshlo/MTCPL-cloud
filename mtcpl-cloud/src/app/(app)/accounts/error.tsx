"use client";

// Per-department error boundary for Finance (Migration 036 — Phase 3).
//
// If anything under /accounts/* throws — a bills query times out, a
// payment-status read fails, a stale RPC blows up — the error stays
// contained here. Production routes (cutting/, carving/, dispatch/)
// keep rendering normally. Same goes the other way for /inventory.

import { useEffect } from "react";
import Link from "next/link";

export default function FinanceErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[finance-error-boundary]", {
      message: error.message,
      digest: error.digest,
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
      <div style={{ fontSize: 32, marginBottom: 10 }}>💼 ⚠️</div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
        Finance page failed to load
      </h1>
      <p
        style={{
          margin: "10px 0 0",
          fontSize: 14,
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        Something went wrong loading this Finance page. Production and other
        Finance pages are still healthy.
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
          href="/accounts/bills"
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
          ← All Bills
        </Link>
      </div>
    </div>
  );
}
