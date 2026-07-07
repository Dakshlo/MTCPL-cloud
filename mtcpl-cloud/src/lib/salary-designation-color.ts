/**
 * Deterministic designation → colour (Daksh Jul 2026).
 *
 * ONE source of truth so a designation shows the SAME colour everywhere — the
 * on-screen Salary/PF grouping AND the PF-register Excel export (its rotated
 * designation column and the "Designation-wise total" subtotal table match).
 *
 * Each colour is a soft, readable LIGHT background paired with a dark foreground
 * (so bold text sits clearly on it, on screen and in Excel). `bg`/`fg` are CSS
 * hex; `bgArgb`/`fgArgb` are the exceljs ARGB form ("FF" + hex).
 */

export type DesignationColor = { bg: string; fg: string; bgArgb: string; fgArgb: string };

const PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#F3E5EA", fg: "#7A2E43" }, // rosewood (house accent)
  { bg: "#FBEFD6", fg: "#92600B" }, // amber
  { bg: "#DCF0EC", fg: "#0F5F55" }, // teal
  { bg: "#E1ECFB", fg: "#1E4E8C" }, // blue
  { bg: "#ECE6F7", fg: "#5B3E9C" }, // violet
  { bg: "#E3F2E1", fg: "#2C6B34" }, // green
  { bg: "#FBE6E1", fg: "#9C4230" }, // coral
  { bg: "#E7ECF1", fg: "#3B4A5A" }, // slate
  { bg: "#F6EFD9", fg: "#7A5C13" }, // gold
  { bg: "#FBE6F1", fg: "#97316B" }, // pink
  { bg: "#DEF1F6", fg: "#14657A" }, // cyan
  { bg: "#ECEEDB", fg: "#5C6113" }, // olive
];

// Blank / "no designation" / "no organization" gets a calm neutral grey rather
// than a palette hue (the helper is shared by designations AND site labels).
const NEUTRAL: { bg: string; fg: string } = { bg: "#EEF0F2", fg: "#475569" };

const toArgb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();

/** Stable colour for a designation / organization label. Same input → same colour, always. */
export function designationColor(name: string | null | undefined): DesignationColor {
  const key = (name ?? "").trim();
  const chosen = !key || /^\(?no (designation|organization)/i.test(key)
    ? NEUTRAL
    : PALETTE[hash(key.toUpperCase()) % PALETTE.length];
  return { bg: chosen.bg, fg: chosen.fg, bgArgb: toArgb(chosen.bg), fgArgb: toArgb(chosen.fg) };
}

/** Small, stable string hash (djb2-ish). */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
