"use client";

/**
 * Semi-circular progress gauge — [[GAUGE:...]] widget.
 *
 * Replaces a "Current / Target / Gap" row of stat tiles with one
 * eye-catching arc that shows where you are, where you're headed,
 * and the distance between.
 *
 * Colour scheme adapts to the current/target ratio:
 *   ≥ target   → green (you're at/over goal)
 *   ≥ 70% of target → amber (closing in)
 *   < 70%           → red (long way to go)
 *
 * Pure SVG — no animation deps.
 */

import { useId } from "react";

export type GaugeProps = {
  label: string;
  current: number;
  target: number;
  /** % / pp / CFT / whatever unit the numbers carry. */
  unit?: string;
  /** Optional secondary caption below the gauge. */
  caption?: string;
  /** Override the default labels ("Current" / "Target"). */
  currentLabel?: string;
  targetLabel?: string;
  /** Min value for the arc. Default 0. */
  min?: number;
  /** Max value for the arc. Defaults to max(current, target) * 1.1. */
  max?: number;
};

const GOLD = "#E8C572";
const GREEN = "#4ade80";
const AMBER = "#f59e0b";
const RED = "#fca5a5";
const WHITE_FAINT = "rgba(255,255,255,0.55)";
const WHITE_LINE = "rgba(255,255,255,0.1)";
const TRACK = "rgba(255,255,255,0.08)";

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-IN");
  return Number(n.toFixed(n % 1 === 0 ? 0 : 1)).toLocaleString("en-IN");
}

export function Gauge({
  label,
  current,
  target,
  unit = "",
  caption,
  currentLabel = "Current",
  targetLabel = "Target",
  min = 0,
  max,
}: GaugeProps) {
  const uid = useId();
  const maxVal = max ?? Math.max(current, target, 1) * 1.1;
  const range = Math.max(1, maxVal - min);
  const currentPct = Math.max(0, Math.min(1, (current - min) / range));
  const targetPct = Math.max(0, Math.min(1, (target - min) / range));

  const ratio = target !== 0 ? current / target : 0;
  const color = ratio >= 1 ? GREEN : ratio >= 0.7 ? AMBER : RED;
  const gap = target - current;
  const gapSign = gap > 0 ? "+" : "";

  // Arc geometry — 180° semi-circle from 180° to 0°
  const W = 260;
  const H = 150;
  const CX = W / 2;
  const CY = H - 20;
  const R = 100;
  const STROKE = 18;

  // Build an arc path from angle A1 to angle A2 (degrees, 0° = right, 180° = left).
  // We sweep counter-clockwise from 180° to 0° over a fill ratio.
  function arcPath(fillFraction: number): string {
    const clamped = Math.max(0, Math.min(1, fillFraction));
    if (clamped === 0) return "";
    const startAngleDeg = 180;
    const endAngleDeg = 180 - 180 * clamped;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = CX + R * Math.cos(rad(startAngleDeg));
    const y1 = CY + R * Math.sin(-rad(startAngleDeg)); // SVG y inverted
    const x2 = CX + R * Math.cos(rad(endAngleDeg));
    const y2 = CY + R * Math.sin(-rad(endAngleDeg));
    const largeArc = clamped > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  // Target tick position on the arc
  const targetAngleDeg = 180 - 180 * targetPct;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const tickOuterR = R + STROKE / 2 + 2;
  const tickInnerR = R - STROKE / 2 - 2;
  const tx1 = CX + tickOuterR * Math.cos(rad(targetAngleDeg));
  const ty1 = CY - tickOuterR * Math.sin(rad(targetAngleDeg));
  const tx2 = CX + tickInnerR * Math.cos(rad(targetAngleDeg));
  const ty2 = CY - tickInnerR * Math.sin(rad(targetAngleDeg));

  return (
    <div
      style={{
        margin: "14px 0",
        padding: 16,
        background: "rgba(0,0,0,0.2)",
        border: "1px solid " + WHITE_LINE,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: WHITE_FAINT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Gauge SVG */}
        <div style={{ flex: "0 0 auto", position: "relative" }}>
          <svg width={W} height={H} role="img" aria-label={`Gauge: ${current} of ${target}`}>
            {/* Track */}
            <path
              d={arcPath(1)}
              fill="none"
              stroke={TRACK}
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
            {/* Filled arc up to current */}
            <path
              d={arcPath(currentPct)}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
            />
            {/* Target tick */}
            <line
              x1={tx1}
              y1={ty1}
              x2={tx2}
              y2={ty2}
              stroke={GOLD}
              strokeWidth={3}
              strokeLinecap="round"
            />
            {/* Min / max labels */}
            <text x={CX - R} y={CY + 16} textAnchor="middle" fontSize={10} fill={WHITE_FAINT}>
              {fmt(min)}
            </text>
            <text x={CX + R} y={CY + 16} textAnchor="middle" fontSize={10} fill={WHITE_FAINT}>
              {fmt(maxVal)}
            </text>
            {/* Centre readout */}
            <text
              x={CX}
              y={CY - 20}
              textAnchor="middle"
              fontSize={32}
              fontWeight={800}
              fill={color}
              fontFamily="ui-monospace, monospace"
            >
              {fmt(current)}
              {unit && (
                <tspan fontSize={14} fill={WHITE_FAINT}>
                  {" " + unit}
                </tspan>
              )}
            </text>
            <text
              x={CX}
              y={CY - 2}
              textAnchor="middle"
              fontSize={10}
              fill={WHITE_FAINT}
              letterSpacing="1"
            >
              {currentLabel.toUpperCase()}
            </text>
          </svg>
        </div>

        {/* Side stats */}
        <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 8, minWidth: 140 }}>
          <StatRow id={uid + "-t"} label={targetLabel} value={target} unit={unit} color={GOLD} />
          <StatRow
            id={uid + "-g"}
            label="Gap"
            value={Math.abs(gap)}
            unit={unit}
            prefix={gap === 0 ? "on target ✓" : gap > 0 ? gapSign : "over by "}
            color={gap <= 0 ? GREEN : ratio >= 0.7 ? AMBER : RED}
          />
        </div>
      </div>

      {caption && (
        <div style={{ fontSize: 12, color: WHITE_FAINT, marginTop: 10, paddingTop: 8, borderTop: "1px dashed " + WHITE_LINE }}>
          {caption}
        </div>
      )}
    </div>
  );
}

function StatRow({
  id,
  label,
  value,
  unit,
  color,
  prefix,
}: {
  id: string;
  label: string;
  value: number;
  unit?: string;
  color: string;
  prefix?: string;
}) {
  return (
    <div
      id={id}
      style={{
        padding: "8px 12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid " + WHITE_LINE,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: WHITE_FAINT, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "ui-monospace, monospace", lineHeight: 1.2 }}>
        {prefix && prefix.includes("✓") ? (
          <span style={{ fontSize: 13 }}>{prefix}</span>
        ) : (
          <>
            {prefix && <span style={{ color: WHITE_FAINT, fontSize: 14, marginRight: 2 }}>{prefix}</span>}
            {fmt(value)}
            {unit && (
              <span style={{ fontSize: 11, fontWeight: 600, color: WHITE_FAINT, marginLeft: 3 }}>
                {unit}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
