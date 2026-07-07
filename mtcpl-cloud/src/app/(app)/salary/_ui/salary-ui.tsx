/**
 * Salary/PF shared UI primitives (Daksh Jul 2026).
 *
 * Finance-grade shapes (KPI cards, tables, designation chips) re-authored on
 * the app's OWN gold/rosewood CSS vars — Salary matches Finance's SHAPE while
 * staying on-brand. Self-contained: no cross-department runtime imports.
 * The one shared source of truth is designationColor() (used here AND by the
 * PF-register Excel export) so a designation reads the identical colour on
 * screen and in the file.
 */

import type React from "react";
import { designationColor } from "@/lib/salary-designation-color";

/** The label a blank designation is grouped under — MUST match the export
 *  route's literal so screen and sheet never drift. */
export const NO_DESIG = "(No designation)";

type Tone = "neutral" | "gold" | "success" | "warn" | "danger";
const TONE: Record<Tone, { accent: string; chipBg: string; value: string }> = {
  neutral: { accent: "var(--muted)", chipBg: "var(--bg)", value: "var(--text)" },
  gold: { accent: "var(--gold-dark)", chipBg: "var(--gold-subtle, rgba(201,161,74,0.14))", value: "var(--text)" },
  success: { accent: "#15803d", chipBg: "rgba(22,101,52,0.10)", value: "#15803d" },
  warn: { accent: "#b45309", chipBg: "rgba(217,119,6,0.12)", value: "#b45309" },
  danger: { accent: "#b91c1c", chipBg: "rgba(220,38,38,0.10)", value: "#b91c1c" },
};

/** Finance-style headline tile: left accent bar + tone-tinted icon chip. */
export function KpiCard({ label, value, sub, tone = "neutral", icon }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: string;
}) {
  const t = TONE[tone];
  return (
    <div style={{ position: "relative", overflow: "hidden", padding: "15px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)" }}>
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.accent, opacity: 0.85 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {icon && (
          <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: t.chipBg, fontSize: 16, flexShrink: 0 }}>{icon}</span>
        )}
        <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", lineHeight: 1.25 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "ui-monospace, monospace", letterSpacing: "-0.01em", color: t.value }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** A responsive KPI grid wrapper. */
export function KpiRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
      {children}
    </div>
  );
}

/** A designation pill in its own stable colour (matches the Excel register). */
export function DesigChip({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" }) {
  const dc = designationColor(name);
  const label = (name ?? "").trim() || "No designation";
  const pad = size === "sm" ? "1px 7px" : "2px 9px";
  const fs = size === "sm" ? 10 : 11;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: pad, borderRadius: 999, background: dc.bg, color: dc.fg, fontSize: fs, fontWeight: 800, whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: dc.fg, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/** Shared table styling (Finance shape, gold theme). */
export const SALARY_TABLE = {
  wrap: { border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow)" } as React.CSSProperties,
  scroll: { overflowX: "auto" } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" } as React.CSSProperties,
  th: { padding: "9px 11px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)", position: "sticky", top: 0, zIndex: 1 } as React.CSSProperties,
  thRight: { textAlign: "right" } as React.CSSProperties,
  td: { padding: "10px 11px", fontSize: 12.5, borderBottom: "1px solid var(--border)", verticalAlign: "middle" } as React.CSSProperties,
};

/** Segmented-control button style (gold active state) — for the tab bar. */
export function segStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 13, fontWeight: 800, padding: "8px 16px", borderRadius: 7, cursor: "pointer",
    border: "none", transition: "background .12s, color .12s, box-shadow .12s",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--gold-dark)" : "var(--muted)",
    boxShadow: active ? "var(--shadow)" : "none",
  };
}

/** A soft status/info pill (dotted, tone-tinted). */
export function Pill({ label, tone = "neutral" }: { label: React.ReactNode; tone?: Tone }) {
  const t = TONE[tone];
  const textColor = tone === "gold" ? "var(--gold-dark)" : tone === "neutral" ? "var(--muted)" : t.value;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: textColor, background: t.chipBg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: t.accent }} />
      {label}
    </span>
  );
}
