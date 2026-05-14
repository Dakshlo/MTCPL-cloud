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
  sizeSpec,
  unit,
  qty,
  pendingOut,
  secondaryLine,
  href,
  emphasis,
}: {
  name: string;
  componentType: ScaffoldingComponentType;
  sizeSpec: string | null;
  unit: string;
  qty: number;
  pendingOut?: number;
  /** Optional secondary line below the qty (e.g. "+312 out at sites"). */
  secondaryLine?: ReactNode;
  /** If provided, the card wraps in an <a>. */
  href?: string;
  emphasis?: "default" | "muted";
}) {
  const level = stockLevel(qty);
  const muted = emphasis === "muted";
  const card = (
    <div
      style={{
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
        minHeight: 200,
        opacity: muted ? 0.7 : 1,
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        cursor: href ? "pointer" : "default",
      }}
    >
      {/* Icon block */}
      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: INV_THEME.steel,
          minHeight: 80,
        }}
      >
        <ComponentIcon type={componentType} size={72} />
      </div>

      {/* Name + size */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: INV_THEME.steel,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {name}
        </div>
        {sizeSpec && (
          <div
            style={{
              fontSize: 10,
              color: INV_THEME.steelLight,
              marginTop: 1,
              letterSpacing: "0.04em",
            }}
          >
            {sizeSpec}
          </div>
        )}
      </div>

      {/* Quantity block */}
      <div
        style={{
          background: INV_THEME.cream,
          borderRadius: 8,
          padding: "10px 8px",
          textAlign: "center",
          border: `1px solid ${INV_THEME.parchment}`,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: qty > 0 ? INV_THEME.steel : INV_THEME.stockOut,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {qty.toLocaleString("en-IN")}
        </div>
        <div
          style={{
            fontSize: 10,
            color: INV_THEME.steelLight,
            marginTop: 2,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {unit}
        </div>
      </div>

      {/* Status + secondary line */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StockDots level={level} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: INV_THEME.steelLight,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {level === "healthy" ? "in stock" : level === "low" ? "low stock" : "empty"}
          </span>
          {pendingOut !== undefined && pendingOut > 0 && (
            <span
              title={`${pendingOut} ${unit} pending approval`}
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 700,
                color: INV_THEME.pending,
                background: "rgba(212, 146, 58, 0.12)",
                padding: "2px 6px",
                borderRadius: 4,
                letterSpacing: "0.04em",
              }}
            >
              −{pendingOut} pending
            </span>
          )}
        </div>
        {secondaryLine && (
          <div
            style={{
              fontSize: 10,
              color: INV_THEME.steelLight,
              letterSpacing: "0.02em",
            }}
          >
            {secondaryLine}
          </div>
        )}
      </div>
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

/** A "card grid" container — responsive 4-col on wide, 2-col on
 *  tablet, 1-col on phone. Matches the rest of the codebase's grid
 *  feel. */
export function ComponentCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}
