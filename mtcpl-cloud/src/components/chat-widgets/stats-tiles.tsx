"use client";

/**
 * Headline stat tiles — the "KPI row" that opens most reports. Triggered by
 * `[[STATS:{ "tiles": [...] }]]`. Each tile: label, value, unit, colour tag.
 *
 * Colour tags map to semantic status palettes:
 *   good       → green  (available, on-time, healthy)
 *   warn       → amber  (reserved, attention)
 *   bad        → red    (overdue, rejected, blocked)
 *   neutral    → gold   (brand default)
 *   muted      → grey   (consumed, historical)
 */

import { useId } from "react";

export type StatTile = {
  label: string;
  value: number | string;
  unit?: string;
  color?: "good" | "warn" | "bad" | "neutral" | "muted";
  sub?: string; // small subtitle under the value ("↑ 12% vs last week" etc.)
};

const PALETTE: Record<NonNullable<StatTile["color"]>, { fg: string; bg: string; bar: string }> = {
  good: { fg: "#4ade80", bg: "rgba(22,163,74,0.10)", bar: "#16A34A" },
  warn: { fg: "#f59e0b", bg: "rgba(217,119,6,0.10)", bar: "#D97706" },
  bad: { fg: "#fca5a5", bg: "rgba(220,38,38,0.10)", bar: "#DC2626" },
  neutral: { fg: "#E8C572", bg: "rgba(232,197,114,0.08)", bar: "#E8C572" },
  muted: { fg: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.04)", bar: "rgba(255,255,255,0.2)" },
};

function fmt(value: StatTile["value"]): string {
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-IN");
      return Number(value.toFixed(2)).toLocaleString("en-IN");
    }
    return String(value);
  }
  return value;
}

export function StatsTiles({ tiles }: { tiles: StatTile[] }) {
  const uid = useId();
  if (!tiles || tiles.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${tiles.length > 3 ? 140 : 170}px, 1fr))`,
        gap: 10,
        margin: "14px 0",
      }}
    >
      {tiles.map((t, i) => {
        const pal = PALETTE[t.color ?? "neutral"];
        return (
          <div
            key={`${uid}-${i}`}
            style={{
              position: "relative",
              padding: "12px 14px",
              background: pal.bg,
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Accent bar on the left */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                width: 3,
                background: pal.bar,
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 5,
              }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: pal.fg,
                lineHeight: 1.05,
                letterSpacing: "-0.3px",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {fmt(t.value)}
              {t.unit && (
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginLeft: 4 }}>
                  {t.unit}
                </span>
              )}
            </div>
            {t.sub && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                {t.sub}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
