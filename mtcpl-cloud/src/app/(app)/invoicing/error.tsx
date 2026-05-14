"use client";

// Per-department error boundary for Invoicing (Mig 038).

import { useEffect } from "react";
import Link from "next/link";

export default function InvoicingErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[invoicing-error-boundary]", {
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
      <div style={{ fontSize: 32, marginBottom: 10 }}>🧾 ⚠️</div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
        Invoicing page failed to load
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
        Production, Finance, and Inventory are unaffected.
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
          href="/invoicing"
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
          ← Invoicing list
        </Link>
      </div>
    </div>
  );
}
