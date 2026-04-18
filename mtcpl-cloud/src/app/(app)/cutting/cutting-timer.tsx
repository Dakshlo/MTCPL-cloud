"use client";

import { useEffect, useState } from "react";

/** Format elapsed time as a compact duration ("3h 35m" / "2h" / "< 1m"). */
function formatDuration(startIso: string): { label: string; overdue: boolean } {
  const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (diff < 60) return { label: "< 1m", overdue: false };
  const m = Math.floor(diff / 60);
  if (m < 60) return { label: `${m}m`, overdue: false };
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return { label: rem === 0 ? `${h}h` : `${h}h ${rem}m`, overdue: false };
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  const label = remH === 0 ? `${d}d` : `${d}d ${remH}h`;
  return { label, overdue: true };
}

/**
 * Live elapsed-time badge. Defaults to the cutting-stage phrasing; pass
 * `prefix` to reuse it for other stages (e.g. Pending Approval).
 *
 * Updates itself every 60 seconds.
 */
export function CuttingTimer({
  startedAt,
  prefix = "Cutting from last",
}: {
  startedAt: string;
  prefix?: string;
}) {
  const [state, setState] = useState(() => formatDuration(startedAt));

  useEffect(() => {
    setState(formatDuration(startedAt));
    const id = setInterval(() => setState(formatDuration(startedAt)), 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  const tooltip = state.overdue
    ? `⚠️ More than a day — ${prefix.toLowerCase()} ${state.label}`
    : `${prefix} ${state.label}`;

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        color: state.overdue ? "#DC2626" : "var(--gold-dark)",
        background: state.overdue ? "rgba(220,38,38,0.08)" : "rgba(184,115,51,0.10)",
        border: `1px solid ${state.overdue ? "rgba(220,38,38,0.35)" : "rgba(184,115,51,0.25)"}`,
        borderRadius: 6,
        padding: "2px 8px",
      }}
    >
      {state.overdue ? "⚠️" : "⏱"} {prefix} {state.label}
    </span>
  );
}
