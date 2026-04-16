"use client";

import { useEffect, useState } from "react";

function timeAgo(startIso: string): { label: string; overdue: boolean } {
  const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (diff < 60) return { label: "just now", overdue: false };
  const m = Math.floor(diff / 60);
  if (m < 60) return { label: `${m} min ago`, overdue: false };
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return { label: rem === 0 ? `${h}h ago` : `${h}h ${rem}m ago`, overdue: false };
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  const label = remH === 0 ? `${d}d ago` : `${d}d ${remH}h ago`;
  return { label, overdue: true };
}

export function CuttingTimer({ startedAt }: { startedAt: string }) {
  const [state, setState] = useState(() => timeAgo(startedAt));

  useEffect(() => {
    setState(timeAgo(startedAt));
    const id = setInterval(() => setState(timeAgo(startedAt)), 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span
      title={state.overdue ? "⚠️ Block has been in cutting for over a day" : "Time in cutting stage"}
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
      {state.overdue ? "⚠️" : "⏱"} {state.label}
    </span>
  );
}
