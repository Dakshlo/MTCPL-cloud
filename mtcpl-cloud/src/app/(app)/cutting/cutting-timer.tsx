"use client";

import { useEffect, useState } from "react";

function timeAgo(startIso: string): string {
  const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h ago`;
  return `${h}h ${rem}m ago`;
}

export function CuttingTimer({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState(() => timeAgo(startedAt));

  useEffect(() => {
    setDisplay(timeAgo(startedAt));
    // Update every minute — no need to tick every second for "X min ago"
    const id = setInterval(() => setDisplay(timeAgo(startedAt)), 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span
      title="Time in cutting stage"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        color: "var(--gold-dark)",
        background: "rgba(184,115,51,0.10)",
        border: "1px solid rgba(184,115,51,0.25)",
        borderRadius: 6,
        padding: "2px 8px",
      }}
    >
      ⏱ {display}
    </span>
  );
}
