"use client";

/**
 * Client bits for the Cockpit dashboard (Daksh, Aug 2026) — only what
 * genuinely needs the browser: the daily hero photo (needs onError
 * fallback) and the live IST clock.
 */

import { useEffect, useState } from "react";

/** Daily rotating hero art. `src` is chosen server-side from the
 *  public/daily manifest; a missing/broken file falls back to a warm
 *  gradient so the hero never shows a broken-image icon. */
export function HeroArt({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  const showImg = src && !broken;
  return (
    <div style={{ position: "relative", minHeight: 168, height: "100%", borderRadius: 14, overflow: "hidden", background: "linear-gradient(135deg, #2d2410 0%, #5c4a1e 55%, #8a6410 100%)" }}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Temple of the day"
          onError={() => setBroken(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 44, filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }}>🛕</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", color: "rgba(255,235,190,0.85)", textTransform: "uppercase" }}>
            Mateshwari Temples
          </span>
          {/* Dev-only hint until the photo set arrives. */}
          <span style={{ fontSize: 9.5, color: "rgba(255,235,190,0.55)" }}>
            daily photo: drop images in public/daily
          </span>
        </div>
      )}
    </div>
  );
}

/** Small live IST clock for the hero. Renders nothing until mounted so
 *  the server HTML never carries a stale time. */
export function CockpitClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
      {now} IST
    </span>
  );
}
