// ──────────────────────────────────────────────────────────────────
// Migration 041 — Component card
// ──────────────────────────────────────────────────────────────────
// One card per (scaffolding_component × selected site) tuple on the
// main inventory board. Big icon, dominant qty number, stock-level
// dot row, optional secondary line (e.g. "+12 out at sites").
// ──────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { ComponentIcon, type ScaffoldingComponentType } from "./component-icon";
import { INV_THEME } from "./theme";
import { stockLevel } from "./stock";

export function ComponentCard({
  name,
  componentType,
  typeLabel,
  sizeSpec,
  unit,
  qty,
  pendingOut,
  secondaryLine,
  href,
  emphasis,
  imageDataUrl,
  yardBreakdown,
}: {
  name: string;
  componentType: ScaffoldingComponentType;
  /** Daksh May 2026 — short human label for the component type
   *  (Standards / Ledgers / Transoms / etc). Rendered as a small
   *  chip in the top-right of the card so the user can still tell
   *  same-name variants apart at a glance now that we render one
   *  flat grid instead of per-type sections. Defaults to nothing
   *  (chip hidden) for callers that don't want it. */
  typeLabel?: string;
  sizeSpec: string | null;
  unit: string;
  qty: number;
  pendingOut?: number;
  /** Optional secondary line below the qty (e.g. "+312 out at sites"). */
  secondaryLine?: ReactNode;
  /** If provided, the card wraps in an <a>. */
  href?: string;
  emphasis?: "default" | "muted";
  /** Mig 044 — uploaded PNG (data URL) for the component. When
   *  present the card shows the real image instead of the SVG. */
  imageDataUrl?: string | null;
  /** Mig 086 — per-yard split of the plant on-hand, e.g.
   *  [{label:"A", qty:50}, …]. Shown only on the plant board. */
  yardBreakdown?: { label: string; qty: number }[];
}) {
  const level = stockLevel(qty);
  const muted = emphasis === "muted";
  // Daksh — scaffolding ships in whole pieces. Display Math.round
  // so legacy fractional values (e.g. 25.01 pcs from before the
  // integer-only rule landed) show as a clean integer in the UI.
  // The underlying value is unchanged; this is display-only.
  const displayQty = Math.round(qty);
  const card = (
    <div
      style={{
        position: "relative",
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 10,
        padding: "10px 10px 9px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
        minHeight: 158,
        opacity: muted ? 0.7 : 1,
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        cursor: href ? "pointer" : "default",
        // Removes the 300ms tap delay on touch devices and stops
        // accidental double-tap zooms when the storekeeper is
        // tapping cards quickly on a tablet.
        touchAction: "manipulation",
      }}
    >
      {/* Type chip — top-right. Absolutely positioned so it doesn't
          push the icon down. Only renders when typeLabel is passed
          (per-type-grouped views can omit it). */}
      {typeLabel && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            fontSize: 8,
            fontWeight: 800,
            color: INV_THEME.steelLight,
            background: INV_THEME.cream,
            border: `1px solid ${INV_THEME.parchment}`,
            padding: "1px 5px",
            borderRadius: 3,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            lineHeight: 1.3,
            pointerEvents: "none",
          }}
        >
          {typeLabel}
        </span>
      )}
      {/* Icon block — shrunk from 88 → 56 to fit 4-per-row on
          portrait tablets and 6-per-row on landscape. */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: INV_THEME.steel,
          minHeight: 56,
        }}
      >
        <ComponentIcon
          type={componentType}
          size={56}
          imageDataUrl={imageDataUrl ?? undefined}
        />
      </div>

      {/* Name + size */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: INV_THEME.steel,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            lineHeight: 1.2,
          }}
        >
          {name}
        </div>
        {sizeSpec && (
          <div
            style={{
              fontSize: 9,
              color: INV_THEME.steelLight,
              marginTop: 1,
              letterSpacing: "0.04em",
            }}
          >
            {sizeSpec}
          </div>
        )}
      </div>

      {/* Quantity block — auto-grows so the bottom row pins to the
          card edge. */}
      <div
        style={{
          background: INV_THEME.cream,
          borderRadius: 6,
          padding: "6px 6px",
          textAlign: "center",
          border: `1px solid ${INV_THEME.parchment}`,
          marginTop: "auto",
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: qty > 0 ? INV_THEME.steel : INV_THEME.stockOut,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {displayQty.toLocaleString("en-IN")}
        </div>
        <div
          style={{
            fontSize: 9,
            color: INV_THEME.steelLight,
            marginTop: 1,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {unit}
        </div>
      </div>

      {/* Status + secondary line — compact single row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <StockDots level={level} />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: INV_THEME.steelLight,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {level === "healthy" ? "in" : level === "low" ? "low" : "empty"}
        </span>
        {pendingOut !== undefined && pendingOut > 0 && (
          <span
            title={`${Math.round(pendingOut)} ${unit} pending approval`}
            style={{
              marginLeft: "auto",
              fontSize: 9,
              fontWeight: 700,
              color: INV_THEME.pending,
              background: "rgba(212, 146, 58, 0.12)",
              padding: "1px 5px",
              borderRadius: 3,
              letterSpacing: "0.03em",
            }}
          >
            −{Math.round(pendingOut)}
          </span>
        )}
      </div>
      {/* Mig 086 — per-yard split (plant board only). */}
      {yardBreakdown && yardBreakdown.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {yardBreakdown.map((y) => (
            <span
              key={y.label}
              title={`Yard ${y.label}`}
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                color: y.qty > 0 ? INV_THEME.steel : INV_THEME.steelLight,
                background: INV_THEME.cream,
                border: `1px solid ${INV_THEME.parchment}`,
                borderRadius: 3,
                padding: "1px 4px",
                letterSpacing: "0.02em",
              }}
            >
              {y.label} {Math.round(y.qty).toLocaleString("en-IN")}
            </span>
          ))}
        </div>
      )}
      {secondaryLine && (
        <div
          style={{
            fontSize: 9,
            color: INV_THEME.steelLight,
            letterSpacing: "0.02em",
            lineHeight: 1.3,
          }}
        >
          {secondaryLine}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {card}
      </a>
    );
  }
  return card;
}

function StockDots({ level }: { level: "healthy" | "low" | "out" }) {
  const colors = {
    healthy: [INV_THEME.stockHealthy, INV_THEME.stockHealthy, INV_THEME.stockHealthy],
    low: [INV_THEME.stockLow, INV_THEME.stockLow, "rgba(0,0,0,0.1)"],
    out: [INV_THEME.stockOut, "rgba(0,0,0,0.1)", "rgba(0,0,0,0.1)"],
  }[level];
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {colors.map((c, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: c,
          }}
        />
      ))}
    </span>
  );
}

/** A "card grid" container — responsive. Daksh May 2026: shrunk
 *  the minmax floor from 170px → 140px so a portrait tablet
 *  (~768px wide minus the sidebar) lands on 4 cards per row instead
 *  of 1. Landscape tablets get 5-6 per row. Phones still collapse
 *  to 2-3 because the floor is below half-width. */
export function ComponentCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}
