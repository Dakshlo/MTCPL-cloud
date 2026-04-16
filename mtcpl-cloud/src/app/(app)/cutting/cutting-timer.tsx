"use client";

import { useEffect, useState } from "react";

function elapsed(startIso: string): string {
  const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (diff < 0) return "0s";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function CuttingTimer({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState(() => elapsed(startedAt));

  useEffect(() => {
    setDisplay(elapsed(startedAt));
    const id = setInterval(() => setDisplay(elapsed(startedAt)), 1000);
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
        fontFamily: "ui-monospace, monospace",
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
