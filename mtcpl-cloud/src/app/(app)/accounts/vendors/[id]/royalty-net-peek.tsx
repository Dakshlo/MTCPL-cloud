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

  const color = netValue > 0 ? "#15803d" : "#b91c1c";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
        fontSize: 11,
        fontWeight: 600,
        color: "var(--muted)",
        fontFamily: "ui-monospace, monospace",
        letterSpacing: "0.02em",
      }}
      title="Royalty points net balance — click the dot to reveal for 10s"
    >
      Net:{" "}
      {revealed ? (
        <span
          style={{
            color,
            fontWeight: 800,
            transition: "opacity 0.15s ease",
          }}
        >
          {netValue > 0 ? "+" : "−"}
          {Math.abs(netValue).toLocaleString("en-IN")}
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              color: "var(--muted)",
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            ({remaining}s)
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          aria-label="Reveal royalty net balance for 10 seconds"
          title="Click to reveal for 10 seconds"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            border: "none",
            background: "transparent",
            borderRadius: "50%",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              opacity: 0.6,
            }}
          />
        </button>
      )}
    </div>
  );
}
