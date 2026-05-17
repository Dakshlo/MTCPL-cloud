"use client";

/**
 * Mig 058 follow-on (Daksh): privacy peek for sensitive KPIs on the
 * Due Bills page. The TOTAL OUTSTANDING and TOP VENDOR amounts
 * render blurred by default — so a glance at a shared screen
 * doesn't leak the company's cash position. A small "👁 Peek for
 * 5s" button reveals all wrapped values for 5 seconds, then they
 * re-blur automatically.
 *
 * Shape:
 *   <PeekProvider>
 *     <PeekButton />           — small button, shows countdown when revealed
 *     <PeekValue>{anything}</PeekValue>  — wraps content with conditional blur
 *   </PeekProvider>
 *
 * Multiple PeekValues inside one provider share state — one click
 * unblurs everything inside, one timer re-blurs everything.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const PEEK_DURATION_S = 5;

type PeekState = {
  revealed: boolean;
  remaining: number;
  reveal: () => void;
};

const PeekContext = createContext<PeekState>({
  revealed: false,
  remaining: 0,
  reveal: () => {},
});

export function PeekProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!revealed) return;
    setRemaining(PEEK_DURATION_S);
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

  const reveal = useCallback(() => setRevealed(true), []);

  return (
    <PeekContext.Provider value={{ revealed, remaining, reveal }}>
      {children}
    </PeekContext.Provider>
  );
}

/** Wraps any content (text, numbers, JSX) with a conditional blur.
 *  Blurred state uses CSS `filter: blur(8px)` + `user-select: none`
 *  so users can't drag-select to read the value through the blur. */
export function PeekValue({ children }: { children: ReactNode }) {
  const { revealed } = useContext(PeekContext);
  return (
    <span
      style={{
        display: "inline-block",
        transition: "filter 0.18s ease, opacity 0.18s ease",
        ...(revealed
          ? {}
          : {
              filter: "blur(8px)",
              userSelect: "none" as const,
              opacity: 0.85,
            }),
      }}
      aria-hidden={!revealed ? "false" : undefined}
    >
      {children}
    </span>
  );
}

/** The visible "Peek for 5s" trigger. Shows a countdown while
 *  revealed; disabled mid-countdown so a stray re-click doesn't
 *  restart the timer (clearer mental model: click → see → hide). */
export function PeekButton({
  label = "Peek for 5s",
}: {
  label?: string;
}) {
  const { revealed, remaining, reveal } = useContext(PeekContext);
  return (
    <button
      type="button"
      onClick={reveal}
      disabled={revealed}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        fontSize: 12,
        fontWeight: 700,
        background: revealed ? "#fef3c7" : "#fff",
        color: revealed ? "#92400e" : "var(--text)",
        border: `1px solid ${revealed ? "#d97706" : "#cbd5e1"}`,
        borderRadius: 8,
        cursor: revealed ? "default" : "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.12s",
        letterSpacing: "0.02em",
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
        {revealed ? "⏱" : "👁"}
      </span>
      {revealed ? `Hiding in ${remaining}s` : label}
    </button>
  );
}
