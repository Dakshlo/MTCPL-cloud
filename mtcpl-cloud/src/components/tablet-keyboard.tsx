"use client";

// Tablet-only on-screen keyboard for slab/temple-code search (Daksh, Jun 2026).
//
// On the floor tablets, the browser's default keyboard is painful for typing
// slab codes like OM-0037 and dimensions like 53x29x14 over and over. This
// replaces it (ONLY on touch-primary devices — never laptops/desktops) with a
// purpose-built pad: alphabets on the left, digits 1–0 + X on the right, and
// a row of the available temple codes — tap "OM" and it types "OM-".
//
// Detection: `(pointer: coarse)` matches when the PRIMARY pointer is touch
// (tablets/phones) and NOT on a laptop/desktop (primary = mouse/trackpad),
// even touchscreen laptops. When active the input gets inputMode="none" so the
// native keyboard never appears; on desktop it's an ordinary <input>.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
// Per-device tally of which temple codes get used, so the chips float the
// most-used to the left.
const USAGE_KEY = "mtcpl:tablet-temple-code-usage";

export function TabletSearchInput({
  value,
  onChange,
  placeholder,
  templeCodes,
  inputStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  templeCodes: string[];
  inputStyle?: CSSProperties;
}) {
  const [isTablet, setIsTablet] = useState(false);
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setIsTablet(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      /* no matchMedia → treat as desktop */
    }
    try {
      const raw = window.localStorage.getItem(USAGE_KEY);
      if (raw) setUsage(JSON.parse(raw) as Record<string, number>);
    } catch {
      /* ignore */
    }
  }, []);

  const bump = (code: string) =>
    setUsage((prev) => {
      const next = { ...prev, [code]: (prev[code] ?? 0) + 1 };
      try {
        window.localStorage.setItem(USAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Most-used temple codes first (left), then by count, ties alphabetical.
  const sortedCodes = useMemo(
    () => [...templeCodes].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a.localeCompare(b)),
    [templeCodes, usage],
  );

  const focusBack = () => ref.current?.focus({ preventScroll: true });
  const type = (t: string) => {
    onChange(value + t);
    focusBack();
  };
  const back = () => {
    onChange(value.slice(0, -1));
    focusBack();
  };
  const clearAll = () => {
    onChange("");
    focusBack();
  };
  const hide = () => {
    setOpen(false);
    ref.current?.blur();
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={isTablet ? "none" : undefined}
        onFocus={() => {
          if (isTablet) setOpen(true);
        }}
        style={{ width: "100%", ...inputStyle }}
      />
      {isTablet && open && (
        <div
          // Keep the caret in the input when a key is tapped (don't blur it).
          // mousedown-preventDefault is the safe, click-preserving way to do
          // this; the keyboard also stays open across a stray blur because its
          // visibility is state-driven, and inputMode="none" keeps the native
          // keyboard from popping back on re-focus.
          onMouseDown={(e) => e.preventDefault()}
          style={panel}
        >
          {/* Temple-code chips — tap to type "CODE-" */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
              Temple
            </span>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, paddingBottom: 2 }}>
              {sortedCodes.length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--muted-light)" }}>— no codes —</span>
              ) : (
                sortedCodes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      type(`${code}-`);
                      bump(code);
                    }}
                    style={chip}
                  >
                    {code}
                  </button>
                ))
              )}
            </div>
            <button type="button" onClick={hide} style={{ ...ctrl, flexShrink: 0, background: "var(--surface)" }}>
              ⌄ Hide
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
            {/* Left — alphabet */}
            <div style={{ flex: "1.7 1 0", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {ALPHABET.map((ch) => (
                <button key={ch} type="button" onClick={() => type(ch)} style={key}>
                  {ch}
                </button>
              ))}
              <button type="button" onClick={() => type(" ")} style={{ ...key, gridColumn: "span 7", fontSize: 13, fontWeight: 700 }}>
                space
              </button>
            </div>

            {/* Right — digits 1–0 + X */}
            <div style={{ flex: "1 1 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {DIGITS.map((d) => (
                <button key={d} type="button" onClick={() => type(d)} style={keyNum}>
                  {d}
                </button>
              ))}
              {/* . for decimal sizes (e.g. 25.5) */}
              <button type="button" onClick={() => type(".")} style={keyNum}>
                .
              </button>
              <button type="button" onClick={() => type("0")} style={keyNum}>
                0
              </button>
              <button type="button" onClick={() => type("x")} style={{ ...keyNum, color: "#1d4ed8" }}>
                X
              </button>
              <button type="button" onClick={back} style={{ ...keyNum, color: "#b45309" }}>
                ⌫
              </button>
              <button type="button" onClick={clearAll} style={{ ...ctrl, gridColumn: "span 2" }}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const panel: CSSProperties = {
  position: "fixed",
  left: "var(--content-left, 0)",
  right: 0,
  bottom: 0,
  zIndex: 2000,
  background: "var(--surface)",
  borderTop: "1px solid var(--border)",
  boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
  padding: "10px 14px max(10px, env(safe-area-inset-bottom))",
};
const key: CSSProperties = {
  minHeight: 46,
  fontSize: 18,
  fontWeight: 700,
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "var(--bg)",
  color: "var(--text)",
  cursor: "pointer",
};
const keyNum: CSSProperties = { ...key, fontFamily: "ui-monospace, monospace", fontSize: 20 };
const chip: CSSProperties = {
  flexShrink: 0,
  minHeight: 36,
  padding: "0 14px",
  fontSize: 14,
  fontWeight: 800,
  fontFamily: "ui-monospace, monospace",
  border: "1.5px solid #92400e",
  borderRadius: 999,
  background: "rgba(146,64,14,0.08)",
  color: "#92400e",
  cursor: "pointer",
};
const ctrl: CSSProperties = {
  minHeight: 44,
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "var(--bg)",
  color: "var(--muted)",
  cursor: "pointer",
};
