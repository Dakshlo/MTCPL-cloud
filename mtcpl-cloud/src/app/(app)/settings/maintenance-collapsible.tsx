"use client";

// Collapsible wrapper for the developer-only maintenance toggles
// (Mig 038 housekeeping — Daksh asked to tuck these away at the
// bottom of the Settings page so they don't sit at the top of the
// daily-use page).
//
// Uses the native HTML <details> element so the open/closed state is
// browser-managed (no React state needed). Custom styling on the
// <summary> makes it look like the other Settings cards. Default is
// CLOSED — the maintenance cards are rarely visited, and putting them
// behind a click keeps the page tidy.

import type { ReactNode } from "react";

export function MaintenanceCollapsible({ children }: { children: ReactNode }) {
  return (
    <details
      style={{
        marginTop: 18,
        background: "var(--surface, #fff)",
        border: "1.5px solid var(--border)",
        borderLeft: "5px solid #f59e0b",
        borderRadius: 14,
        padding: "0",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 20px",
          cursor: "pointer",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "rgba(245, 158, 11, 0.12)",
            color: "#b45309",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          🛠️
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              color: "var(--text)",
            }}
          >
            Maintenance &amp; system status
          </div>
        </div>
        <span
          style={{
            fontSize: 12,
            color: "var(--muted)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            padding: "3px 10px",
            borderRadius: 6,
            fontWeight: 700,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          Click to open ▾
        </span>
      </summary>
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "16px 20px 4px",
          background: "var(--bg)",
        }}
      >
        {children}
      </div>
    </details>
  );
}
