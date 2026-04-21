"use client";

/**
 * Colored boxed callout — [[INSIGHT:...]] widget.
 *
 * For "strategy takeaways", "key recommendation", "warning", "what to
 * do next" sections that would otherwise render as plain markdown
 * bullets. Gives them a coloured border, an icon, a title band, and
 * optional numbered / prioritised bullets.
 *
 * Tone drives the palette:
 *   good     → green  (recommendation / do-this)
 *   warn     → amber  (caution / tradeoff)
 *   bad      → red    (danger / avoid)
 *   info     → blue   (FYI / context)
 *   neutral  → gold   (brand default)
 */

import { useId } from "react";

export type InsightItem = {
  /** Short headline for the bullet. Renders bold. */
  label: string;
  /** Optional supporting body text below the label. */
  body?: string;
  /** Optional icon at the start of the bullet (emoji or unicode). */
  icon?: string;
};

export type InsightBoxProps = {
  title: string;
  tone?: "good" | "warn" | "bad" | "info" | "neutral";
  /** Optional header icon. Defaults per tone. */
  icon?: string;
  /** Optional single-sentence lead under the title. */
  lead?: string;
  /** The bullets. Rendered numbered if `numbered` is true. */
  items: InsightItem[];
  /** Show numbered bullets instead of icon bullets. */
  numbered?: boolean;
};

const PALETTE = {
  good: { fg: "#4ade80", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.4)", accent: "#16A34A" },
  warn: { fg: "#f59e0b", bg: "rgba(217,119,6,0.08)", border: "rgba(217,119,6,0.4)", accent: "#D97706" },
  bad:  { fg: "#fca5a5", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.4)", accent: "#DC2626" },
  info: { fg: "#93c5fd", bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.4)", accent: "#2563EB" },
  neutral: { fg: "#E8C572", bg: "rgba(232,197,114,0.08)", border: "rgba(232,197,114,0.35)", accent: "#C9973A" },
};

const DEFAULT_ICON = {
  good: "✅",
  warn: "⚠️",
  bad: "🚫",
  info: "ℹ️",
  neutral: "💡",
};

export function InsightBox({ title, tone = "neutral", icon, lead, items, numbered = false }: InsightBoxProps) {
  const uid = useId();
  const pal = PALETTE[tone];
  const hdrIcon = icon ?? DEFAULT_ICON[tone];

  if (!items || items.length === 0) return null;

  return (
    <div
      style={{
        margin: "14px 0",
        background: pal.bg,
        border: "1px solid " + pal.border,
        borderLeft: "4px solid " + pal.accent,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid " + pal.border,
          background: "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: pal.fg,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>{hdrIcon}</span>
          <span>{title}</span>
        </div>
        {lead && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 4, lineHeight: 1.55 }}>
            {lead}
          </div>
        )}
      </div>

      {/* Items */}
      <div style={{ padding: "8px 14px 12px" }}>
        {items.map((it, i) => (
          <div
            key={`${uid}-${i}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "7px 0",
              borderBottom: i < items.length - 1 ? "1px dashed rgba(255,255,255,0.06)" : "none",
            }}
          >
            {/* Leading marker — number chip or icon */}
            <span
              style={{
                flex: "0 0 auto",
                minWidth: numbered ? 22 : "auto",
                height: numbered ? 22 : "auto",
                borderRadius: numbered ? "50%" : 0,
                background: numbered ? pal.accent : "transparent",
                color: numbered ? "#fff" : pal.fg,
                fontSize: numbered ? 11 : 15,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
                marginTop: 1,
              }}
            >
              {numbered ? i + 1 : it.icon ?? "•"}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f0f0", lineHeight: 1.4 }}>
                {it.label}
              </div>
              {it.body && (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2, lineHeight: 1.55 }}>
                  {it.body}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
