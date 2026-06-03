"use client";

// ──────────────────────────────────────────────────────────────────
// Migration 041 — Component card  (Daksh, June 2026: click → detail)
// ──────────────────────────────────────────────────────────────────
// One card per (scaffolding_component × selected site) on the board.
// Big icon, dominant qty, stock dots, per-yard split chips.
//
// Clicking a card (board mode — no href) opens a centred detail
// modal with the full picture: total at plant, per-yard counts (full
// names), what's out at each site, and pending movements.
// ──────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ComponentIcon, type ScaffoldingComponentType } from "./component-icon";
import { INV_THEME } from "./theme";

// Daksh (June 2026) — cards open on a deliberate 1-second HOLD, not a
// single tap (a tap on a tablet was opening the detail by accident).
const HOLD_MS = 1000;

// Inlined (was imported from ./stock, which pulls server-only code —
// can't live in a "use client" module). Pure qty → level mapping.
function stockLevel(qty: number): "healthy" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty < 10) return "low";
  return "healthy";
}

type YardCount = { label: string; qty: number };
type SiteCount = { name: string; qty: number };

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
  siteBreakdown,
  outAtSitesTotal,
  tint,
  interactive = true,
}: {
  name: string;
  componentType: ScaffoldingComponentType;
  typeLabel?: string;
  sizeSpec: string | null;
  unit: string;
  qty: number;
  pendingOut?: number;
  secondaryLine?: ReactNode;
  /** If provided, the card is a link (no detail modal). */
  href?: string;
  emphasis?: "default" | "muted";
  imageDataUrl?: string | null;
  /** Mig 086 — per-yard split of the plant on-hand. label = full
   *  yard name ("Yard A"). Shown on the plant board + modal. */
  yardBreakdown?: YardCount[];
  /** Mig 086 — what's out at each project site (modal only). */
  siteBreakdown?: SiteCount[];
  outAtSitesTotal?: number;
  /** Soft per-type background tint so a type reads as one group. */
  tint?: string;
  /** When false, the card is a plain (non-clickable) tile — used on
   *  project-site views where the yard/site detail doesn't apply. */
  interactive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  const level = stockLevel(qty);
  const muted = emphasis === "muted";
  const displayQty = Math.round(qty);
  const isClickable = interactive && !href;

  function cancelHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
    setHolding(false);
  }
  function startHold(e: React.PointerEvent) {
    holdStart.current = { x: e.clientX, y: e.clientY };
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
      setOpen(true);
    }, HOLD_MS);
  }
  function moveHold(e: React.PointerEvent) {
    // Drift > 12px = the user is scrolling, not holding → cancel.
    if (!holdStart.current) return;
    const dx = e.clientX - holdStart.current.x;
    const dy = e.clientY - holdStart.current.y;
    if (dx * dx + dy * dy > 144) cancelHold();
  }
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const card = (
    <div
      onPointerDown={isClickable ? startHold : undefined}
      onPointerMove={isClickable ? moveHold : undefined}
      onPointerUp={isClickable ? cancelHold : undefined}
      onPointerLeave={isClickable ? cancelHold : undefined}
      onPointerCancel={isClickable ? cancelHold : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `${name} — hold to view details` : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }
          : undefined
      }
      style={{
        position: "relative",
        background: tint ?? INV_THEME.paper,
        border: `1px solid ${holding ? INV_THEME.copper : INV_THEME.parchment}`,
        borderRadius: 10,
        padding: "12px 12px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
        minHeight: 172,
        opacity: muted ? 0.7 : 1,
        transition:
          "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
        transform: holding ? "scale(0.97)" : "scale(1)",
        cursor: isClickable || href ? "pointer" : "default",
        touchAction: "manipulation",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Hold-to-open progress bar — fills over HOLD_MS while pressed. */}
      {holding && (
        <>
          <style>{`@keyframes invHoldFill{from{width:0%}to{width:100%}}`}</style>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              height: 3,
              background: INV_THEME.copper,
              borderRadius: "0 2px 0 0",
              animation: `invHoldFill ${HOLD_MS}ms linear forwards`,
            }}
          />
        </>
      )}
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
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: INV_THEME.steel,
          minHeight: 66,
        }}
      >
        <ComponentIcon
          type={componentType}
          size={66}
          imageDataUrl={imageDataUrl ?? undefined}
        />
      </div>

      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
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

      {/* Mig 086 — per-yard split, full names + readable font. */}
      {yardBreakdown && yardBreakdown.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {yardBreakdown.map((y) => (
            <span
              key={y.label}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: y.qty > 0 ? INV_THEME.steel : INV_THEME.steelLight,
                background: INV_THEME.cream,
                border: `1px solid ${INV_THEME.parchment}`,
                borderRadius: 5,
                padding: "2px 8px",
                letterSpacing: "0.01em",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {y.label}: {Math.round(y.qty).toLocaleString("en-IN")}
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

  return (
    <>
      {card}
      {open && (
        <ComponentDetailModal
          onClose={() => setOpen(false)}
          name={name}
          componentType={componentType}
          typeLabel={typeLabel}
          sizeSpec={sizeSpec}
          unit={unit}
          qty={displayQty}
          level={level}
          pendingOut={pendingOut ?? 0}
          imageDataUrl={imageDataUrl}
          yardBreakdown={yardBreakdown ?? []}
          siteBreakdown={siteBreakdown ?? []}
          outAtSitesTotal={outAtSitesTotal ?? 0}
          tint={tint}
        />
      )}
    </>
  );
}

function ComponentDetailModal({
  onClose,
  name,
  componentType,
  typeLabel,
  sizeSpec,
  unit,
  qty,
  level,
  pendingOut,
  imageDataUrl,
  yardBreakdown,
  siteBreakdown,
  outAtSitesTotal,
  tint,
}: {
  onClose: () => void;
  name: string;
  componentType: ScaffoldingComponentType;
  typeLabel?: string;
  sizeSpec: string | null;
  unit: string;
  qty: number;
  level: "healthy" | "low" | "out";
  pendingOut: number;
  imageDataUrl?: string | null;
  yardBreakdown: YardCount[];
  siteBreakdown: SiteCount[];
  outAtSitesTotal: number;
  tint?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(28, 52, 69, 0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          maxHeight: "88vh",
          overflowY: "auto",
          background: INV_THEME.cream,
          border: `1px solid ${INV_THEME.parchment}`,
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "18px 20px",
            background: tint ?? INV_THEME.paper,
            borderBottom: `1px solid ${INV_THEME.parchment}`,
            borderRadius: "16px 16px 0 0",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: INV_THEME.steel,
              background: INV_THEME.paper,
              border: `1px solid ${INV_THEME.parchment}`,
              borderRadius: 12,
            }}
          >
            <ComponentIcon
              type={componentType}
              size={56}
              imageDataUrl={imageDataUrl ?? undefined}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {typeLabel && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: INV_THEME.steelLight,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {typeLabel}
              </div>
            )}
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                color: INV_THEME.steel,
                lineHeight: 1.15,
                marginTop: 2,
              }}
            >
              {name}
            </div>
            {sizeSpec && (
              <div style={{ fontSize: 12, color: INV_THEME.steelLight, marginTop: 2 }}>
                {sizeSpec}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              color: INV_THEME.steelLight,
              cursor: "pointer",
              padding: 4,
              alignSelf: "flex-start",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Total at plant */}
          <div
            style={{
              background: INV_THEME.paper,
              border: `1px solid ${INV_THEME.parchment}`,
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: INV_THEME.steelLight,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                At plant (total)
              </div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  color: qty > 0 ? INV_THEME.steel : INV_THEME.stockOut,
                  lineHeight: 1.05,
                  fontFeatureSettings: '"tnum"',
                  marginTop: 2,
                }}
              >
                {fmt(qty)}{" "}
                <span style={{ fontSize: 13, fontWeight: 700, color: INV_THEME.steelLight }}>
                  {unit}
                </span>
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "4px 10px",
                borderRadius: 999,
                color:
                  level === "healthy"
                    ? INV_THEME.stockHealthy
                    : level === "low"
                      ? INV_THEME.stockLow
                      : INV_THEME.stockOut,
                background:
                  level === "healthy"
                    ? "rgba(94,140,78,0.12)"
                    : level === "low"
                      ? "rgba(212,146,58,0.14)"
                      : "rgba(193,68,46,0.12)",
              }}
            >
              {level === "healthy" ? "In stock" : level === "low" ? "Low" : "Empty"}
            </span>
          </div>

          {/* Per-yard breakdown */}
          <Section title="By yard (warehouse)">
            {yardBreakdown.length === 0 ? (
              <Muted>No yards configured.</Muted>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {yardBreakdown.map((y) => (
                  <Row key={y.label} label={y.label} value={`${fmt(y.qty)} ${unit}`} dim={y.qty <= 0} />
                ))}
              </div>
            )}
          </Section>

          {/* Out at sites */}
          <Section title={`Out at sites${outAtSitesTotal > 0 ? ` · ${fmt(outAtSitesTotal)} ${unit}` : ""}`}>
            {siteBreakdown.length === 0 ? (
              <Muted>Nothing deployed to a project site.</Muted>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {siteBreakdown.map((s) => (
                  <Row key={s.name} label={s.name} value={`${fmt(s.qty)} ${unit}`} />
                ))}
              </div>
            )}
          </Section>

          {/* Pending */}
          {pendingOut > 0 && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: INV_THEME.pending,
                background: "rgba(212, 146, 58, 0.12)",
                border: `1px solid ${INV_THEME.pending}`,
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              ⏳ {fmt(pendingOut)} {unit} pending approval (movement in flight)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: INV_THEME.steelLight,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 7,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "9px 12px",
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 8,
        opacity: dim ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: INV_THEME.steel }}>{label}</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 800,
          color: INV_THEME.steel,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: INV_THEME.steelLight, fontStyle: "italic" }}>
      {children}
    </div>
  );
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
          style={{ width: 6, height: 6, borderRadius: "50%", background: c }}
        />
      ))}
    </span>
  );
}

/** Responsive card grid. Floor 200px → ~5-6 bigger cards per row on a
 *  landscape tablet (Daksh, June 2026). */
export function ComponentCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
