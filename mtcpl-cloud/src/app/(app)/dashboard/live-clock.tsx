"use client";

/**
 * Dashboard v2 — live IST clock for the hero card (Daksh, Aug 2026).
 *
 * Renders nothing meaningful until mounted (SSR prints a static
 * placeholder) so the server/client markup can never mismatch, then
 * ticks every second. Kept deliberately tiny — one interval, no deps.
 */

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // IST wall clock regardless of the viewer's machine timezone.
  const ist = now
    ? new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }))
    : null;
  const hh = ist ? String(ist.getHours()).padStart(2, "0") : "--";
  const mm = ist ? String(ist.getMinutes()).padStart(2, "0") : "--";
  const ss = ist ? String(ist.getSeconds()).padStart(2, "0") : "--";

  return (
    <div style={{ textAlign: "right", lineHeight: 1 }}>
      {/* Colours flow through the dashboard's --dv2-* theme vars so the
          clock reads on both the light and dark skins. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: "flex-end" }}>
        <span style={{ fontSize: 40, fontWeight: 800, color: "var(--dv2-ink, #fff)", letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}>
          {hh}:{mm}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--dv2-faint, rgba(255,255,255,0.45))", fontVariantNumeric: "tabular-nums", width: 24, display: "inline-block", textAlign: "left" }}>
          {ss}
        </span>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--dv2-gold, #E8C572)", marginTop: 6, textTransform: "uppercase" }}>
        India Standard Time
      </div>
    </div>
  );
}
