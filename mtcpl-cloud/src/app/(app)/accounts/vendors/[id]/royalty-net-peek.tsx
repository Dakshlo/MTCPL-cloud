"use client";

/**
 * Mig 061 follow-on (Daksh): the royalty net balance used to render
 * permanently visible as "Net: +/-X" above the bill history. Now it
 * renders as a tiny gray dot — clicking it reveals the value
 * inline for 10 seconds, then collapses back to the dot. Same
 * shoulder-surfing concern that drove the Peek pattern on the
 * Due Bills KPIs.
 *
 * Stateless on the server — the dot button only renders if the
 * caller's role can already see royalty data (gate via canShow on
 * the parent). The 10-second timer is in the client component.
 */

import { useEffect, useState } from "react";
import { SecretDot } from "./secret-dot";

const REVEAL_SECONDS = 10;

export function RoyaltyNetPeek({
  netValue,
}: {
  /** Paid - Received. Positive = paid more than received. */
  netValue: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!revealed) return;
    setRemaining(REVEAL_SECONDS);
    const tick = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(tick);
          setRevealed(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [revealed]);

  if (netValue === 0) return null;

  // Revealed colour stays semantic (green = paid more, red = owed).
  // Dormant dot is plain black — Daksh: "small and black color"
  // so it reads as a neutral marker, not an indicator of state.
  const revealedColor = netValue > 0 ? "#15803d" : "#b91c1c";

  if (revealed) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--muted)",
          fontFamily: "ui-monospace, monospace",
          letterSpacing: "0.02em",
        }}
      >
        Net:{" "}
        <span style={{ color: revealedColor, fontWeight: 800 }}>
          {netValue > 0 ? "+" : "−"}
          {Math.abs(netValue).toLocaleString("en-IN")}
        </span>
        <span
          style={{
            marginLeft: 2,
            fontSize: 10,
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          ({remaining}s)
        </span>
      </div>
    );
  }

  // Reveal only on hover + the secret code "aadesh" (or long-press on touch) —
  // no longer a plain click (Daksh).
  return <SecretDot onUnlock={() => setRevealed(true)} />;
}
