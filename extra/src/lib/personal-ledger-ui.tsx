/**
 * UI primitives used by the Personal Ledger module.
 *
 * Extracted from the original MTCPL accounts/_ui/components.tsx so
 * the module is self-contained — no cross-folder dependency on a
 * finance/accounts UI library. Same shape, same names. The new
 * Claude Code session can theme this freely (colours, fonts) and
 * the rest of the personal-ledger code keeps working.
 *
 * Exports:
 *   • ACCOUNTS_TOKENS   — colour palette (indigo accent, emerald
 *                          success, amber warning, slate neutrals).
 *   • BUTTON_STYLES     — primary / secondary / danger / ghost.
 *   • INPUT_STYLE       — base style for <input>, <select>,
 *                          <textarea>.
 *   • VendorAvatar      — coloured-circle avatar with deterministic
 *                          initials. Reusable for any name-bearing
 *                          entity, despite the legacy name.
 */

import type React from "react";

// ── Design tokens ──────────────────────────────────────────────────
export const ACCOUNTS_TOKENS = {
  accent: "#4f46e5",        // indigo-600 — primary action
  accentLight: "#eef2ff",   // indigo-50
  accentBorder: "#c7d2fe",  // indigo-200
  success: "#15803d",       // emerald-700
  successLight: "#dcfce7",
  warning: "#b45309",       // amber-700
  warningLight: "#fef3c7",
  danger: "#b91c1c",        // rose-700
  dangerLight: "#fee2e2",
  neutral: "#475569",       // slate-600
  neutralLight: "#f1f5f9",  // slate-100
  border: "#e2e8f0",        // slate-200
  borderStrong: "#cbd5e1",  // slate-300
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",  // slate-50
  shadow:
    "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
  shadowLarge:
    "0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)",
};

// ── Button styles ─────────────────────────────────────────────────
export const BUTTON_STYLES = {
  primary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 700,
    background: ACCOUNTS_TOKENS.accent,
    color: "#fff",
    border: "1px solid transparent",
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    letterSpacing: "-0.005em",
    boxShadow: "0 1px 2px rgba(79,70,229,0.18)",
    whiteSpace: "nowrap" as const,
    transition: "all 0.12s",
  },
  secondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    background: "#fff",
    color: "var(--text)",
    border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
    transition: "all 0.12s",
  },
  danger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    background: "#fff",
    color: ACCOUNTS_TOKENS.danger,
    border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
    transition: "all 0.12s",
  },
  ghost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    background: "transparent",
    color: "var(--muted)",
    border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
  },
};

// ── Input style helper ────────────────────────────────────────────
export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  fontSize: 13,
  border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
  borderRadius: 8,
  background: "#fff",
  color: "var(--text)",
  transition: "border-color 0.12s, box-shadow 0.12s",
};

// ── Vendor / Party avatar ─────────────────────────────────────────
// Initials in a coloured circle. Deterministic hue from the name
// so the same name always looks the same across the app.
const AVATAR_PALETTES: Array<{ bg: string; fg: string }> = [
  { bg: "#dbeafe", fg: "#1d4ed8" }, // blue
  { bg: "#dcfce7", fg: "#15803d" }, // emerald
  { bg: "#fef3c7", fg: "#b45309" }, // amber
  { bg: "#fee2e2", fg: "#b91c1c" }, // rose
  { bg: "#e0e7ff", fg: "#4f46e5" }, // indigo
  { bg: "#fae8ff", fg: "#a21caf" }, // fuchsia
  { bg: "#cffafe", fg: "#0e7490" }, // cyan
  { bg: "#fce7f3", fg: "#be185d" }, // pink
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function initialsFor(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9\s]/g, "");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function VendorAvatar({
  name,
  size = 32,
}: {
  name: string;
  size?: number;
}) {
  const palette = AVATAR_PALETTES[hashString(name) % AVATAR_PALETTES.length];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: palette.bg,
        color: palette.fg,
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: "0.02em",
      }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}
