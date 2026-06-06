"use client";

import Link from "next/link";

/**
 * Dashboard entry card for the carving Floor TV mode.
 *
 * Marked "use client" because the hover lift uses inline event
 * handlers (onMouseEnter / onMouseLeave) — those aren't allowed on
 * server components and would crash the dashboard at runtime
 * without this directive.
 *
 * Owner + developer only — sits alongside Ask AI / Block Journey /
 * ID Lookup. Opens /carving/floor?mode=tv in a new tab so the
 * dashboard stays underneath when they want it back. Designed for
 * the wall TV / shop floor display.
 */
export function TvModeEntryCard() {
  return (
    <Link
      href="/carving/floor?mode=tv"
      target="_blank"
      rel="noreferrer"
      style={{
        // Daksh OCD fix — all four dashboard cards equal-height.
        display: "flex",
        flexDirection: "column",
        height: "100%",
        textDecoration: "none",
        background: "linear-gradient(135deg, #1a1a1a 0%, #2D2410 60%, #6b4f18 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(45,36,16,0.15)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      {/* Decorative sparkle accent — same as AskAi card. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(232,197,114,0.25) 0%, rgba(232,197,114,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#E8C572",
              marginBottom: 6,
            }}
          >
            📺 TV Mode
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.2px",
              marginBottom: 4,
            }}
          >
            Carving floor on the wall
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            padding: "8px 14px",
            background: "rgba(232,197,114,0.18)",
            border: "1px solid rgba(232,197,114,0.4)",
            borderRadius: 8,
            color: "#E8C572",
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Open ↗
        </div>
      </div>
    </Link>
  );
}
