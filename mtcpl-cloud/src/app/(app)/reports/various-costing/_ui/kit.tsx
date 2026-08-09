// ─────────────────────────────────────────────────────────────────────
//  Shared presentational kit for the CNC + Cutter "various costing"
//  pages. This is a PURELY VISUAL layer — same components, same props,
//  same page layout as before, just a richer, more premium look:
//  layered card depth, tone-tinted KPI tiles, an iOS-style segmented
//  tab control, accent-barred panel headers, and hover/zebra tables.
//
//  Extracted from the two page.tsx copies so both pages stay in visual
//  lock-step. No data logic lives here.
// ─────────────────────────────────────────────────────────────────────
import Link from "next/link";
import React from "react";

type Tone = "accent" | "success" | "warning";

/** Accent + soft-glow colour per tone. Glow is a translucent wash so it
 *  composites correctly over both light and dark surfaces. */
function toneOf(tone: Tone): { main: string; glow: string } {
  if (tone === "success") return { main: "#10b981", glow: "rgba(16,185,129,0.14)" };
  if (tone === "warning") return { main: "#f59e0b", glow: "rgba(245,158,11,0.14)" };
  return { main: "var(--gold)", glow: "rgba(232,197,114,0.16)" };
}

/** Shared elevated-card shell — soft double shadow + generous radius. */
const cardShell: React.CSSProperties = {
  position: "relative",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 6px 20px rgba(0,0,0,0.045)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  marginTop: 7,
  lineHeight: 1.45,
};

/** Small decorative bits shared by both KPI tiles. */
function TileDecor({ c }: { c: { main: string; glow: string } }) {
  return (
    <>
      {/* soft corner glow */}
      <div
        style={{
          position: "absolute",
          right: -34,
          top: -34,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: c.glow,
          pointerEvents: "none",
        }}
      />
      {/* thin top accent that fades out to the right */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          background: `linear-gradient(90deg, ${c.main}, transparent 78%)`,
        }}
      />
    </>
  );
}

function TileHead({ c, label }: { c: { main: string; glow: string }; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 3,
          background: c.main,
          boxShadow: `0 0 0 3px ${c.glow}`,
          flexShrink: 0,
        }}
      />
      <div style={labelStyle}>{label}</div>
    </div>
  );
}

/** Single big-number KPI tile. */
export function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
}) {
  const c = toneOf(tone);
  return (
    <div style={{ ...cardShell, padding: "18px 20px" }}>
      <TileDecor c={c} />
      <TileHead c={c} label={label} />
      <div
        style={{
          fontSize: 29,
          fontWeight: 800,
          color: "var(--text)",
          letterSpacing: "-0.025em",
          marginTop: 10,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

/** Two-stacked-value KPI tile (e.g. units/day over ₹/day). */
export function DualKpiTile({
  label,
  primary,
  secondary,
  hint,
  tone,
}: {
  label: string;
  primary: string;
  secondary: string;
  hint?: string;
  tone: Tone;
}) {
  const c = toneOf(tone);
  return (
    <div style={{ ...cardShell, padding: "18px 20px" }}>
      <TileDecor c={c} />
      <TileHead c={c} label={label} />
      <div
        style={{
          fontSize: 21,
          fontWeight: 800,
          color: "var(--text)",
          letterSpacing: "-0.02em",
          marginTop: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {primary}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "var(--text)",
          opacity: 0.82,
          marginTop: 3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {secondary}
      </div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

/** Label/value line used inside panels (Cutter depreciation snapshot). */
export function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: bold ? 800 : 600,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Section panel — accent-bar header on a subtle gradient, elevated body. */
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardShell}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "13px 18px",
          borderBottom: "1px solid var(--border)",
          background: "linear-gradient(180deg, var(--surface-alt), var(--surface))",
          ...labelStyle,
        }}
      >
        <span style={{ width: 5, height: 15, borderRadius: 3, background: "var(--gold)", flexShrink: 0 }} />
        {title}
      </div>
      {children}
    </div>
  );
}

/** iOS-style segmented track that wraps the period tabs. */
export function TabBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        marginLeft: "auto",
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 4,
        gap: 3,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

/** One segment inside <TabBar>. Active = gold fill with a soft lift. */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "7px 16px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? "var(--gold)" : "transparent",
        color: active ? "#fff" : "var(--muted)",
        border: "none",
        borderRadius: 9,
        textDecoration: "none",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        boxShadow: active ? "0 2px 6px rgba(0,0,0,0.18)" : "none",
      }}
    >
      {children}
    </Link>
  );
}

export function PickerLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </span>
  );
}

export function pickerRow(): React.CSSProperties {
  return { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 };
}

export function pickerInput(): React.CSSProperties {
  return {
    padding: "8px 11px",
    fontSize: 13,
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 9,
  };
}

export function pickerBtn(): React.CSSProperties {
  return {
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--gold)",
    color: "#fff",
    border: "1px solid var(--gold-dark)",
    borderRadius: 9,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(212,165,74,0.30)",
  };
}

export function th(): React.CSSProperties {
  return {
    padding: "11px 14px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    textAlign: "left",
  };
}

export function td(): React.CSSProperties {
  return {
    padding: "11px 14px",
    fontSize: 13,
    color: "var(--text)",
  };
}

/** One-line scoped stylesheet giving both pages hover + gentle zebra on
 *  every table, without having to touch each <tr>. Drop <VcStyles/> once
 *  per page and put className="vc-page" on the outer <section>. Totals
 *  rows keep their inline gold background (inline beats the stylesheet). */
export function VcStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.vc-page tbody tr { transition: background .12s ease; }
.vc-page tbody tr:nth-child(even) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.vc-page tbody tr:hover { background: color-mix(in srgb, var(--gold) 12%, transparent); }
`,
      }}
    />
  );
}
