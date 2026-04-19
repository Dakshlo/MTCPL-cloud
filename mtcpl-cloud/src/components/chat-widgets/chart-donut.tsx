"use client";

/**
 * Donut chart for showing proportions — stone mix, block-status breakdown,
 * facility split, etc. Triggered by `[[CHART:{"type":"donut", ...}]]`.
 */

import { useId, useMemo } from "react";

export type DonutSlice = {
  label: string;
  value: number;
  color?: string;
};

const DEFAULT_COLORS = [
  "#E8C572",
  "#C87A60",
  "#B8B6AC",
  "#7F77DD",
  "#639922",
  "#D4537E",
  "#E24B4A",
  "#378ADD",
];

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.abs(n) < 1000 ? Number(n.toFixed(2)) : Math.round(n);
  return rounded.toLocaleString("en-IN");
}

export function ChartDonut({ title, slices }: { title?: string; slices: DonutSlice[] }) {
  const uid = useId();
  const total = useMemo(() => slices.reduce((s, x) => s + Math.max(0, x.value), 0), [slices]);

  const SIZE = 140;
  const STROKE = 22;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;

  // Compute arc segments
  const arcs = useMemo(() => {
    if (total <= 0) return [];
    let offset = 0;
    return slices.map((s, i) => {
      const len = (Math.max(0, s.value) / total) * CIRC;
      const color = s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      const arc = { color, len, offset, pct: (s.value / total) * 100 };
      offset += len;
      return arc;
    });
  }, [slices, total, CIRC]);

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
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 12 }}>
          {title}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        {/* SVG donut */}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }}>
          {/* Background ring */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={STROKE}
          />
          {/* Segments */}
          {arcs.map((a, i) => (
            <circle
              key={`${uid}-${i}`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeDasharray={`${a.len} ${CIRC - a.len}`}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              style={{ transition: "stroke-dasharray 0.5s ease-out" }}
            />
          ))}
          {/* Centre label — total */}
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 4}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)"
            fontSize={10}
            fontWeight={600}
            style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
            Total
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 14}
            textAnchor="middle"
            fill="rgba(255,255,255,0.95)"
            fontSize={18}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
          >
            {fmtNumber(total)}
          </text>
        </svg>

        {/* Legend */}
        <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 6 }}>
          {slices.map((s, i) => {
            const color = s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <div key={`${uid}-leg-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span style={{ flex: 1, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.label}>
                  {s.label}
                </span>
                <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700, fontFamily: "ui-monospace, monospace", minWidth: 48, textAlign: "right" }}>
                  {fmtNumber(s.value)}
                </span>
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontFamily: "ui-monospace, monospace", minWidth: 36, textAlign: "right" }}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
