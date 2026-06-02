// ──────────────────────────────────────────────────────────────────
// Migration 041 — Scaffolding component icons
// ──────────────────────────────────────────────────────────────────
// One SVG per `scaffolding_component_type` enum value. Lightweight
// line-art glyphs, monochrome via currentColor so the card's text
// colour drives the stroke. ViewBox is 96×96 throughout.
//
// The icons are intentionally simple geometric shapes rather than
// photo-realistic illustrations. Storekeepers recognise components
// by their silhouette — a vertical bar with end caps is a Standard,
// a horizontal bar with hooks is a Ledger. Quick scan, no detail
// noise.
//
// New component types added in the enum need a matching glyph here;
// fallback is the `other` icon (a stack of crates).
// ──────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactElement } from "react";

export type ScaffoldingComponentType =
  | "standard"
  | "ledger"
  | "transom"
  // Mig 044 — perforated screen panel. Catalog collapsed to four
  // top-level types: Standard / Ledger / Transom / Jali. The other
  // historical types stay in the union so legacy inventory_movements
  // rows that point at them keep deserializing cleanly.
  | "jali"
  | "brace"
  | "jack_base"
  | "u_head"
  | "coupler"
  | "plank"
  | "ladder"
  | "toe_board"
  | "tie_rod"
  | "other";

type IconProps = {
  size?: number;
  style?: CSSProperties;
};

const baseProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 96 96",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  xmlns: "http://www.w3.org/2000/svg",
});

function Standard({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Standard">
      <line x1="48" y1="14" x2="48" y2="82" />
      <rect x="36" y="10" width="24" height="6" rx="1.5" fill="currentColor" />
      <rect x="36" y="80" width="24" height="6" rx="1.5" fill="currentColor" />
      <circle cx="48" cy="32" r="2.5" fill="currentColor" />
      <circle cx="48" cy="48" r="2.5" fill="currentColor" />
      <circle cx="48" cy="64" r="2.5" fill="currentColor" />
    </svg>
  );
}

function Ledger({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Ledger">
      <line x1="14" y1="48" x2="82" y2="48" />
      <path d="M 14 48 L 10 42 M 14 48 L 10 54" />
      <path d="M 82 48 L 86 42 M 82 48 L 86 54" />
      <rect x="22" y="44" width="6" height="8" fill="currentColor" />
      <rect x="68" y="44" width="6" height="8" fill="currentColor" />
    </svg>
  );
}

function Transom({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Transom">
      <line x1="22" y1="48" x2="74" y2="48" />
      <rect x="18" y="40" width="6" height="16" fill="currentColor" />
      <rect x="72" y="40" width="6" height="16" fill="currentColor" />
    </svg>
  );
}

function Brace({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Brace">
      <line x1="18" y1="78" x2="78" y2="18" />
      <circle cx="18" cy="78" r="5" fill="currentColor" />
      <circle cx="78" cy="18" r="5" fill="currentColor" />
    </svg>
  );
}

function JackBase({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Jack base">
      <rect x="14" y="72" width="68" height="10" rx="2" fill="currentColor" />
      <line x1="48" y1="20" x2="48" y2="72" />
      {/* threaded shaft markings */}
      <line x1="40" y1="36" x2="56" y2="36" />
      <line x1="40" y1="46" x2="56" y2="46" />
      <line x1="40" y1="56" x2="56" y2="56" />
      <line x1="40" y1="66" x2="56" y2="66" />
      <rect x="36" y="14" width="24" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

function UHead({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="U-Head">
      <line x1="48" y1="50" x2="48" y2="86" />
      <path d="M 28 20 L 28 46 L 68 46 L 68 20" />
      <line x1="40" y1="80" x2="56" y2="80" />
      <line x1="40" y1="56" x2="56" y2="56" />
    </svg>
  );
}

function Coupler({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Coupler">
      <circle cx="34" cy="48" r="14" />
      <circle cx="62" cy="48" r="14" />
      <line x1="34" y1="34" x2="34" y2="22" />
      <line x1="62" y1="34" x2="62" y2="22" />
      <line x1="20" y1="48" x2="76" y2="48" strokeOpacity="0" />
      <line x1="48" y1="48" x2="48" y2="48" />
      <circle cx="34" cy="48" r="3" fill="currentColor" />
      <circle cx="62" cy="48" r="3" fill="currentColor" />
    </svg>
  );
}

function Plank({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Plank">
      <rect x="12" y="38" width="72" height="20" rx="2" />
      <line x1="22" y1="44" x2="22" y2="52" />
      <line x1="36" y1="44" x2="36" y2="52" />
      <line x1="60" y1="44" x2="60" y2="52" />
      <line x1="74" y1="44" x2="74" y2="52" />
    </svg>
  );
}

function Ladder({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Ladder">
      <line x1="28" y1="14" x2="28" y2="82" />
      <line x1="68" y1="14" x2="68" y2="82" />
      <line x1="28" y1="26" x2="68" y2="26" />
      <line x1="28" y1="40" x2="68" y2="40" />
      <line x1="28" y1="54" x2="68" y2="54" />
      <line x1="28" y1="68" x2="68" y2="68" />
    </svg>
  );
}

function ToeBoard({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Toe board">
      <rect x="10" y="56" width="76" height="14" rx="1.5" fill="currentColor" />
      <line x1="20" y1="56" x2="20" y2="40" />
      <line x1="76" y1="56" x2="76" y2="40" />
    </svg>
  );
}

function TieRod({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Tie rod">
      <line x1="10" y1="48" x2="86" y2="48" />
      <line x1="18" y1="42" x2="18" y2="54" />
      <line x1="34" y1="42" x2="34" y2="54" />
      <line x1="50" y1="42" x2="50" y2="54" />
      <line x1="66" y1="42" x2="66" y2="54" />
      <line x1="78" y1="42" x2="78" y2="54" />
    </svg>
  );
}

function Jali({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Jali">
      {/* Outer frame */}
      <rect x="14" y="14" width="68" height="68" rx="3" />
      {/* Perforated grid — three rows × three cols of small openings */}
      <rect x="24" y="24" width="14" height="14" rx="2" />
      <rect x="42" y="24" width="14" height="14" rx="2" />
      <rect x="60" y="24" width="14" height="14" rx="2" />
      <rect x="24" y="42" width="14" height="14" rx="2" />
      <rect x="42" y="42" width="14" height="14" rx="2" />
      <rect x="60" y="42" width="14" height="14" rx="2" />
      <rect x="24" y="60" width="14" height="14" rx="2" />
      <rect x="42" y="60" width="14" height="14" rx="2" />
      <rect x="60" y="60" width="14" height="14" rx="2" />
    </svg>
  );
}

function Other({ size = 64, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={style} aria-label="Other">
      <rect x="14" y="50" width="32" height="32" rx="2" />
      <rect x="50" y="50" width="32" height="32" rx="2" />
      <rect x="32" y="18" width="32" height="32" rx="2" />
    </svg>
  );
}

const ICONS: Record<ScaffoldingComponentType, (p: IconProps) => ReactElement> = {
  standard: Standard,
  ledger: Ledger,
  transom: Transom,
  jali: Jali,
  brace: Brace,
  jack_base: JackBase,
  u_head: UHead,
  coupler: Coupler,
  plank: Plank,
  ladder: Ladder,
  toe_board: ToeBoard,
  tie_rod: TieRod,
  other: Other,
};

export function ComponentIcon({
  type,
  size = 64,
  style,
  imageDataUrl,
}: {
  type: ScaffoldingComponentType;
  size?: number;
  style?: CSSProperties;
  /** Mig 044 — when the catalog has a real PNG uploaded for the
   *  component, render that instead of the SVG fallback. Daksh
   *  uploads transparent PNGs via the catalog tab; cards across
   *  the inventory module pick them up automatically. */
  imageDataUrl?: string | null;
}) {
  if (imageDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageDataUrl}
        alt={labelForComponentType(type)}
        width={size}
        height={size}
        style={{
          objectFit: "contain",
          // Pull the visual centre slightly tighter than the SVG
          // bounding box so user-uploaded PNGs with their own
          // padding still feel "filled".
          maxWidth: "100%",
          maxHeight: "100%",
          ...style,
        }}
      />
    );
  }
  const Glyph = ICONS[type] ?? Other;
  return <Glyph size={size} style={style} />;
}

/** Human-readable label for a component type (for headings, dropdowns). */
export function labelForComponentType(t: ScaffoldingComponentType): string {
  switch (t) {
    case "standard":
      return "Standard";
    case "ledger":
      return "Ledger";
    case "transom":
      return "Transom";
    case "jali":
      return "Jali";
    case "brace":
      return "Brace";
    case "jack_base":
      return "Jack Base";
    case "u_head":
      return "U-Head";
    case "coupler":
      return "Coupler";
    case "plank":
      return "Plank";
    case "ladder":
      return "Ladder";
    case "toe_board":
      return "Toe Board";
    case "tie_rod":
      return "Tie Rod";
    case "other":
      return "Other";
  }
}

// Mig 083 follow-on (Daksh, June 2026) — "Other" is OFF the picker.
// Daksh: "and on add compent there is option other which is wrong
// it dont create proper." Existing rows tagged 'other' are
// soft-deleted by mig 083; new components must pick a real type.
// (Postgres can't easily drop an enum value, so the value still
// exists in the DB type — we just stop offering it in the UI.)
export const COMPONENT_TYPE_OPTIONS: ScaffoldingComponentType[] = [
  "standard",
  "ledger",
  "transom",
  "jali",
  "brace",
  "jack_base",
  "u_head",
  "coupler",
  "plank",
  "ladder",
  "toe_board",
  "tie_rod",
];
