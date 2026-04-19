"use client";

/**
 * Horizontal bar chart widget rendered inline inside an assistant reply.
 *
 * Triggered by `[[CHART:{"type":"bar", ...}]]` markers Claude emits. Dark-
 * themed to match the chat. Bars animate in on first paint.
 */

import { useId, useMemo } from "react";

export type ChartBarItem = {
  label: string;
  value: number;
  unit?: string;
  color?: string; // CSS color; otherwise assigned from palette
};

const DEFAULT_COLORS = [
  "#E8C572", // gold (MTCPL brand)
  "#C87A60", // PinkStone
  "#B8B6AC", // WhiteStone
  "#7F77DD", // violet
  "#639922", // green
  "#D4537E", // pink
  "#E24B4A", // red
  "#378ADD", // blue
];

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Preserve up to 2 decimals; trim trailing zeros
  const rounded = Math.abs(n) < 1000 ? Number(n.toFixed(2)) : Math.round(n);
  return rounded.toLocaleString("en-IN");
}

export function ChartBar({
  title,
  bars,
}: {
  title?: string;
  bars: ChartBarItem[];
}) {
  const uid = useId();
  const max = useMemo(() => Math.max(1, ...bars.map((b) => b.value)), [bars]);
  const total = useMemo(() => bars.reduce((sum, b) => sum + (Number.isFinite(b.value) ? b.value : 0), 0), [bars]);

  return (
    <div
      style={{
        margin: "14px 0",
        padding: "14px 16px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
      }}
    >
      {title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
          {title}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {bars.map((bar, i) => {
          const pct = Math.max(0, Math.min(100, (bar.value / max) * 100));
          const color = bar.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
          const pctOfTotal = total > 0 ? (bar.value / total) * 100 : 0;
          const valueLabel = `${fmtNumber(bar.value)}${bar.unit ? " " + bar.unit : ""}`;
          return (
            <div key={`${uid}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: "0 0 auto",
                  minWidth: 92,
                  maxWidth: 140,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.75)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={bar.label}
              >
                {bar.label}
              </div>
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  height: 22,
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${color} 0%, ${color} 100%)`,
                    borderRadius: 6,
                    transition: "width 0.5s ease-out",
                  }}
                />
                {pctOfTotal > 0 && pctOfTotal < 100 && (
                  <span
                    style={{
                      position: "absolute",
                      right: 6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: 10,
                      color: "rgba(255,255,255,0.55)",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {pctOfTotal.toFixed(0)}%
                  </span>
                )}
              </div>
              <div
                style={{
                  flex: "0 0 auto",
                  minWidth: 72,
                  textAlign: "right",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.9)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {valueLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
