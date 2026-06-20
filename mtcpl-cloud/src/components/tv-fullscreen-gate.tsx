"use client";

// Full-window "tap to go full screen" gate for the wall TV.
//
// Smart-TV remotes have no keyboard, and browsers refuse to enter full screen
// without a user gesture — so when the page is NOT full screen we cover the
// ENTIRE window with one big blinking button. Clicking ANYWHERE enters full
// screen and reveals the live CNC board. The instant we're in full screen the
// gate disappears; if full screen is ever exited (Esc / remote), it comes back.
import { useEffect, useState } from "react";

export function TvFullscreenGate() {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const update = () => setIsFs(!!document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  if (isFs) return null;

  return (
    <div
      role="button"
      aria-label="Tap to enter full screen and show the CNC board"
      onClick={() => {
        document.documentElement.requestFullscreen?.().catch(() => {
          /* if blocked, the gate stays — another tap will retry */
        });
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        cursor: "pointer",
        userSelect: "none",
        background: "linear-gradient(180deg, #1b1733 0%, #0d0a1c 100%)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
        textAlign: "center",
        padding: 32,
      }}
    >
      <div style={{ fontSize: 140, lineHeight: 1, animation: "tvgate-blink 1.1s ease-in-out infinite" }}>⛶</div>
      <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.4px", animation: "tvgate-blink 1.1s ease-in-out infinite" }}>
        Press anywhere to show the CNC board
      </div>
      <div style={{ fontSize: 20, opacity: 0.55, fontWeight: 600 }}>
        MATESHWARI TEMPLE CONSTRUCTION · Carving Floor
      </div>
      <style>{`@keyframes tvgate-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }`}</style>
    </div>
  );
}
