// ──────────────────────────────────────────────────────────────────
// Migration 041 — Inventory department theme tokens
// ──────────────────────────────────────────────────────────────────
// The Inventory department gets its own visual identity, distinct
// from Production (orange/terra workshop tones) and Finance
// (green/ledger). The metaphor here is a tidy warehouse: steel-blue
// frames, warm copper highlights, cream paper background, parchment
// borders. Numbers in a chunky condensed feel (rendered with
// system fonts + heavy tracking; no extra font load).
//
// Used inline across every inventory page. No CSS-in-JS dependency —
// just plain object literals passed to style props. Pages that need
// custom variations can spread these and override.
// ──────────────────────────────────────────────────────────────────

export const INV_THEME = {
  // Primary palette
  steel: "#2c4a5e",          // headings, primary borders, primary text
  steelDark: "#1d3445",      // hover, active
  steelLight: "#7f96aa",     // muted accent on steel surfaces
  copper: "#c87850",         // accent, primary CTA
  copperDark: "#a35c39",     // active CTA
  cream: "#fbf8f1",          // page background (light theme; dark theme falls back to surface)
  paper: "#ffffff",          // card background
  parchment: "#dfd5c2",      // card border / divider

  // Stock-level dots
  stockHealthy: "#5e8c4e",   // green
  stockLow: "#d4923a",       // amber
  stockOut: "#c1442e",       // red

  // Status pills (movements)
  pending: "#d4923a",
  approved: "#5e8c4e",
  rejected: "#c1442e",
  cancelled: "#7a7568",
} as const;

/**
 * Wraps a page in the inventory aesthetic: cream background, steel
 * accents. The cream background is applied via a wrapping div so it
 * only colours the inventory routes; the rest of the app stays on
 * `var(--bg)`.
 *
 * Dark mode: falls back to the app's regular surface tokens. The
 * cream feel only kicks in for the default (light) theme. Inline
 * styles can't see media queries, so the dark-mode fallback is just
 * that the wrapping container blends into whatever surface is set.
 */
export const inventoryPageWrapper: React.CSSProperties = {
  background: INV_THEME.cream,
  minHeight: "100%",
  padding: "24px 28px 56px",
};

export const inventoryHeading: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: INV_THEME.steel,
  margin: 0,
  letterSpacing: "0.01em",
};

export const inventorySubheading: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: INV_THEME.steelLight,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: 4,
};

export const primaryButton: React.CSSProperties = {
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  background: INV_THEME.copper,
  color: "#fff",
  border: `1px solid ${INV_THEME.copperDark}`,
  borderRadius: 8,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export const secondaryButton: React.CSSProperties = {
  // Daksh (June 2026) — matched to primaryButton's size so the header
  // action row reads as one uniform button set (fill vs outline is
  // the only difference).
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  background: INV_THEME.paper,
  color: INV_THEME.steel,
  border: `1px solid ${INV_THEME.parchment}`,
  borderRadius: 8,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export const cardBase: React.CSSProperties = {
  background: INV_THEME.paper,
  border: `1px solid ${INV_THEME.parchment}`,
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
};
