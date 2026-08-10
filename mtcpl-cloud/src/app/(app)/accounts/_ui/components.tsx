// Shared UI primitives for the Accounts module.
//
// Visual language: Zoho Books / FreshBooks — clean whitespace, soft
// indigo accents, monospace for amounts, vendor avatars with
// deterministic initials, big readable KPIs.
//
// The accounts module overlays its own accent palette on top of the
// app's gold/cream theme so the finance surfaces feel like a
// distinct section without breaking the overall design language.
//
// ── Aug 2026 premium pass (Daksh) ─────────────────────────────────
// Finance is DELIBERATELY A LIGHT SURFACE — a printed-ledger feel,
// like Zoho/QuickBooks — and stays light whatever theme the shell is
// in. That's a product decision, not an oversight: accountants read
// these screens next to paper and printouts all day. So this kit pins
// its own light palette (`ink`, `inkMuted`, `surface`) instead of the
// theme's flipping vars, which also removes the old half-flipped
// state (light table headers + theme-coloured text).
//
// The pass is visual only — sharper radii, tighter//layered shadows,
// hairline rings, gradient accents, tabular numerals. EVERY export
// keeps its exact name, props and shape, so no consuming page's
// layout moves. No data logic lives in this file; `Money` rounding
// is display-only and untouched.

import type React from "react";
import Link from "next/link";

// ── Design tokens ──────────────────────────────────────────────────

export const ACCOUNTS_TOKENS = {
  accent: "#4f46e5",        // indigo-600 — primary action / brand for accounts
  accentLight: "#eef2ff",   // indigo-50  — subtle background
  accentBorder: "#c7d2fe",  // indigo-200 — soft border accent
  success: "#15803d",       // emerald-700
  successLight: "#dcfce7",
  warning: "#b45309",       // amber-700
  warningLight: "#fef3c7",
  danger: "#b91c1c",        // rose-700
  dangerLight: "#fee2e2",
  neutral: "#475569",       // slate-600
  neutralLight: "#f1f5f9",  // slate-100
  border: "#e4e9f0",        // hairline — a touch cooler/crisper than slate-200
  borderStrong: "#cbd5e1",  // slate-300
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",  // slate-50
  // Sharper than the old soft double-blur: a tight contact shadow +
  // a hairline ring, so cards read as crisp sheets rather than fuzzy
  // blobs. Depth comes from the ring, not from blur radius.
  shadow:
    "0 0 0 1px rgba(15,23,42,0.03), 0 1px 2px rgba(15,23,42,0.05)",
  shadowLarge:
    "0 0 0 1px rgba(15,23,42,0.04), 0 2px 4px rgba(15,23,42,0.05), 0 8px 20px rgba(15,23,42,0.07)",

  // ── Added in the Aug 2026 pass (purely additive — existing keys
  //    above keep their meaning so all 60 consumers are unaffected).
  /** Pinned ink colours. Finance stays light, so text never flips. */
  ink: "#0f172a",           // slate-900 — primary text
  inkMuted: "#64748b",      // slate-500 — secondary text
  /** Sharper corner scale. */
  radius: 10,
  radiusSm: 7,
  /** Paper-like surface wash for cards — barely-there vertical fade. */
  surfaceGradient: "linear-gradient(180deg, #ffffff 0%, #fcfdfe 100%)",
  /** Header wash for table heads / panel headers. */
  headerGradient: "linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%)",
  /** Focus ring for inputs (used by INPUT_FOCUS_CLASS consumers). */
  focusRing: "0 0 0 3px rgba(79,70,229,0.14)",
};

// ── Pay-Today section colours (Mig 042 follow-on) ──────────────────
//
// Daksh: "make something different so even on fast scroll user can
// know he change the page section from proposed to confirmed."
//
// Three strongly-differentiated accents — amber/green/blue — used
// on the top KPI pill strip, the sticky section banner per section,
// and the per-row card left border. Shared from this file so the
// page (server component) and the client island agree on the
// colours without prop drilling.
export const SECTION_COLORS = {
  proposed: "#d4923a",  // amber — accountant just proposed, waiting on owner
  confirmed: "#5e8c4e", // green — owner has confirmed, accountant pays next
  paidToday: "#3a6ea8", // blue — done for the day
} as const;

// ── Money display ──────────────────────────────────────────────────

/** Indian-locale currency display. Default size 14px, mono font.
 *  Use `size="hero"` for big numbers on hero blocks and KPI cards.
 *
 *  Mig 081 follow-on (Daksh) — DISPLAY rounding to integer rupees by
 *  default. Daksh: "if number is 100.3 then 100, if 100.7 then 101.
 *  Make sure you don't touch real data — sensitive — but from now
 *  onward new data will be in round-offs." We only change what shows
 *  on screen; the underlying numeric value stored in Postgres is
 *  untouched. Callers that NEED the actual paise (Final Audit
 *  cross-check against bank statement, voucher PDF) pass
 *  `precise={true}` to opt out and get up to 2 fraction digits back. */
export function Money({
  value,
  size = "normal",
  tone,
  prefix = "₹",
  precise = false,
}: {
  value: number;
  size?: "hero" | "large" | "normal" | "small";
  tone?: "success" | "warning" | "danger" | "muted" | "accent";
  prefix?: string;
  /** Show up to 2 fraction digits (the original behaviour). Use
   *  when the displayed value MUST tie out to a paise-level source
   *  (bank statement, audit voucher). Default false → integer
   *  rupees, round half-up. */
  precise?: boolean;
}) {
  const sizes: Record<string, { fontSize: number; fontWeight: number }> = {
    // Mig 058 follow-on (Daksh): hero was 30 — too big once the
    // total crossed 1 crore (₹1,18,43,563.96 wrapped to 2 lines on
    // the Due Bills KPI tile, with .96 jumping below the integer
    // part). Dropped to 22, still meaningfully larger than the
    // rest of the page; whiteSpace: nowrap below keeps the number
    // on one line regardless of width.
    hero: { fontSize: 22, fontWeight: 800 },
    large: { fontSize: 20, fontWeight: 800 },
    normal: { fontSize: 14, fontWeight: 700 },
    small: { fontSize: 12, fontWeight: 600 },
  };
  const tones: Record<string, string> = {
    success: ACCOUNTS_TOKENS.success,
    warning: ACCOUNTS_TOKENS.warning,
    danger: ACCOUNTS_TOKENS.danger,
    muted: ACCOUNTS_TOKENS.inkMuted,
    accent: ACCOUNTS_TOKENS.accent,
  };
  return (
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: tone ? tones[tone] : ACCOUNTS_TOKENS.ink,
        letterSpacing: "-0.02em",
        whiteSpace: "nowrap",
        // Digits share one advance width, so columns of amounts line
        // up perfectly down the page — the single biggest "premium
        // ledger" cue on a finance screen.
        fontVariantNumeric: "tabular-nums",
        ...sizes[size],
      }}
    >
      {prefix}
      {precise
        ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
        : // Math.round explicitly so half values round AWAY from
          // zero (4.5 → 5), matching Daksh's spec. Some browsers'
          // toLocaleString with maximumFractionDigits:0 use banker's
          // rounding which would give 4.5 → 4 — not what we want.
          Math.round(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
    </span>
  );
}

// ── Vendor avatar ──────────────────────────────────────────────────

/** Initials in a colored circle. Deterministic hue from the vendor
 *  name so the same vendor always looks the same across the app. */
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
        // Hairline ring lifts the initials off white table rows.
        boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.06)",
      }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}

/** Avatar + name + optional sub-label, used in tables and cards. */
export function VendorIdentity({
  name,
  subLabel,
  size = 32,
  href,
}: {
  name: string;
  subLabel?: string | null;
  size?: number;
  href?: string;
}) {
  const body = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <VendorAvatar name={name} size={size} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <strong style={{ fontSize: 13, fontWeight: 650, color: ACCOUNTS_TOKENS.ink, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </strong>
        {subLabel && (
          <span style={{ fontSize: 11, color: ACCOUNTS_TOKENS.inkMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {subLabel}
          </span>
        )}
      </span>
    </span>
  );
  if (href) {
    return (
      <Link href={href} className="acct-link" style={{ textDecoration: "none", color: "inherit" }}>
        {body}
      </Link>
    );
  }
  return body;
}

// ── Status pills ───────────────────────────────────────────────────

const BILL_STATUS_TINT: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  pending_approval: { label: "Pending audit",  bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
  approved:         { label: "Approved",        bg: "#dbeafe", fg: "#1e40af", dot: "#3b82f6" },
  rejected:         { label: "Rejected",        bg: "#fee2e2", fg: "#991b1b", dot: "#ef4444" },
  fully_paid:       { label: "Paid in full",    bg: "#dcfce7", fg: "#166534", dot: "#22c55e" },
  cancelled:        { label: "Cancelled",       bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
};

const PAYMENT_STATUS_TINT: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  proposed:      { label: "Proposed",      bg: "#e0e7ff", fg: "#3730a3", dot: "#6366f1" },
  confirmed:     { label: "Confirmed",     bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
  paid:          { label: "Paid",          bg: "#dcfce7", fg: "#166534", dot: "#22c55e" },
  cancelled:     { label: "Cancelled",     bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
  // Mig 052 — bank refused this row (wrong IFSC, account closed,
  // NSF, etc.). Distinct red tint so it stands out vs cancelled.
  bank_rejected: { label: "Bank rejected", bg: "#fee2e2", fg: "#991b1b", dot: "#dc2626" },
};

export function BillStatusPill({ status }: { status: string }) {
  const t = BILL_STATUS_TINT[status] ?? BILL_STATUS_TINT.cancelled;
  return <Pill tint={t} />;
}
export function PaymentStatusPill({ status }: { status: string }) {
  const t = PAYMENT_STATUS_TINT[status] ?? PAYMENT_STATUS_TINT.cancelled;
  return <Pill tint={t} />;
}

function Pill({ tint }: { tint: { label: string; bg: string; fg: string; dot: string } }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 8px",
        borderRadius: 999,
        background: tint.bg,
        color: tint.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        // Tinted hairline instead of a flat blob — reads sharper at
        // small sizes and separates the pill from coloured rows.
        boxShadow: `inset 0 0 0 1px ${tint.dot}33`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tint.dot,
          boxShadow: `0 0 0 2px ${tint.dot}22`,
        }}
      />
      {tint.label}
    </span>
  );
}

// ── KPI card ───────────────────────────────────────────────────────

/** Big hero stat card. Used in a horizontal strip on dashboards. */
export function KpiCard({
  label,
  value,
  sublabel,
  tone = "neutral",
  icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
  href?: string;
}) {
  const toneStyles: Record<string, { accent: string; bg: string }> = {
    neutral: { accent: ACCOUNTS_TOKENS.neutral, bg: ACCOUNTS_TOKENS.neutralLight },
    accent:  { accent: ACCOUNTS_TOKENS.accent, bg: ACCOUNTS_TOKENS.accentLight },
    success: { accent: ACCOUNTS_TOKENS.success, bg: ACCOUNTS_TOKENS.successLight },
    warning: { accent: ACCOUNTS_TOKENS.warning, bg: ACCOUNTS_TOKENS.warningLight },
    danger:  { accent: ACCOUNTS_TOKENS.danger, bg: ACCOUNTS_TOKENS.dangerLight },
  };
  const t = toneStyles[tone];

  const body = (
    <div
      className="acct-kpi"
      style={{
        padding: "16px 18px",
        background: ACCOUNTS_TOKENS.surfaceGradient,
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: ACCOUNTS_TOKENS.radius,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Accent edge — fades out downward so it reads as a lit edge
          rather than a painted stripe. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: `linear-gradient(180deg, ${t.accent} 0%, ${t.accent}55 100%)`,
        }}
      />
      {/* Soft tone-coloured glow bleeding in from the top-right. This
          is what actually makes the card read as "premium" rather than
          a plain white box — it tints the card with its own meaning
          (red for overdue, green for paid) without colouring the whole
          surface and hurting text contrast. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -30,
          top: -30,
          width: 110,
          height: 110,
          borderRadius: "50%",
          background: t.bg,
          opacity: 0.75,
          pointerEvents: "none",
        }}
      />
      {/* position:relative keeps the content painting ABOVE the
          absolutely-positioned glow above it. */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: ACCOUNTS_TOKENS.inkMuted,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 8,
            }}
          >
            {label}
          </div>
          <div style={{ wordBreak: "break-word" }}>{value}</div>
          {sublabel && (
            <div style={{ fontSize: 11, color: ACCOUNTS_TOKENS.inkMuted, marginTop: 6 }}>
              {sublabel}
            </div>
          )}
        </div>
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: ACCOUNTS_TOKENS.radiusSm,
              background: t.bg,
              color: t.accent,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
              boxShadow: `inset 0 0 0 1px ${t.accent}22`,
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {body}
      </Link>
    );
  }
  return body;
}

// ── Empty state ────────────────────────────────────────────────────

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        background: ACCOUNTS_TOKENS.surfaceMuted,
        border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
        borderRadius: ACCOUNTS_TOKENS.radius,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.6 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: ACCOUNTS_TOKENS.ink, letterSpacing: "-0.01em", marginBottom: 6 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 13, color: ACCOUNTS_TOKENS.inkMuted, maxWidth: 420, margin: "0 auto", lineHeight: 1.55 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────

export function SectionHeader({
  title,
  count,
  total,
  action,
  description,
}: {
  title: React.ReactNode;
  count?: number;
  total?: React.ReactNode;
  action?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 12,
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
        flexWrap: "wrap",
      }}
    >
      {/* NOTE: hero + section headings sit directly on the PAGE
          background, not on one of this kit's white cards — so they
          keep the theme's text vars. Pinning them to slate ink would
          make them invisible for anyone running the shell dark. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.015em" }}>
          {title}
        </h2>
        {description && (
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>{description}</p>
        )}
      </div>
      {typeof count === "number" && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{count}</strong>
          {" "}
          {count === 1 ? "row" : "rows"}
          {total != null && <> · {total}</>}
        </span>
      )}
      {action}
    </div>
  );
}

// ── Table style helpers ────────────────────────────────────────────

export const TABLE_STYLES = {
  // Daksh May 2026 — Due Bills has 11 columns (checkbox through
  // Propose). After the Hide-menu button freed up sidebar width,
  // the row STILL pushed Propose off-screen on a typical
  // 1440-wide display. Trimmed padding (12→8 vertical, 14→10
  // horizontal) and font (13→12) so the full row fits in one
  // view. Other accounts tables (All Bills, Payment History,
  // Advances, Final Audit) share these styles too — the slight
  // density change there is fine and actually reads cleaner.
  //
  // Aug 2026: density deliberately UNCHANGED (same padding/font, so
  // no row reflows anywhere) — only colour, weight and numerals were
  // sharpened.
  table: {
    width: "100%",
    borderCollapse: "separate" as const,
    borderSpacing: 0,
    fontSize: 12,
    color: ACCOUNTS_TOKENS.ink,
    // Amount columns line up down the table.
    fontVariantNumeric: "tabular-nums" as const,
  },
  thead: {
    background: ACCOUNTS_TOKENS.headerGradient,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 10px",
    fontSize: 10,
    fontWeight: 700,
    color: ACCOUNTS_TOKENS.neutral,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
    whiteSpace: "nowrap" as const,
  },
  thRight: {
    textAlign: "right" as const,
    padding: "8px 10px",
    fontSize: 10,
    fontWeight: 700,
    color: ACCOUNTS_TOKENS.neutral,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
    verticalAlign: "middle" as const,
    fontSize: 12,
  },
  tdRight: {
    padding: "8px 10px",
    textAlign: "right" as const,
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
    verticalAlign: "middle" as const,
    fontSize: 12,
  },
  tableWrap: {
    background: ACCOUNTS_TOKENS.surface,
    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
    borderRadius: ACCOUNTS_TOKENS.radius,
    overflow: "hidden",
    boxShadow: ACCOUNTS_TOKENS.shadow,
  },
};

// ── Primary / secondary buttons ────────────────────────────────────

export const BUTTON_STYLES = {
  primary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 700,
    // Subtle top-lit gradient reads as a raised key, not a flat block.
    background: `linear-gradient(180deg, #5b53e8 0%, ${ACCOUNTS_TOKENS.accent} 100%)`,
    color: "#fff",
    border: "1px solid transparent",
    borderRadius: ACCOUNTS_TOKENS.radiusSm,
    cursor: "pointer",
    textDecoration: "none",
    letterSpacing: "-0.005em",
    boxShadow:
      "0 1px 2px rgba(79,70,229,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
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
    background: ACCOUNTS_TOKENS.surfaceGradient,
    color: ACCOUNTS_TOKENS.ink,
    border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: ACCOUNTS_TOKENS.radiusSm,
    cursor: "pointer",
    textDecoration: "none",
    boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
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
    borderRadius: ACCOUNTS_TOKENS.radiusSm,
    cursor: "pointer",
    textDecoration: "none",
    boxShadow: "0 1px 1px rgba(185,28,28,0.10)",
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
    color: ACCOUNTS_TOKENS.inkMuted,
    border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: ACCOUNTS_TOKENS.radiusSm,
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
  borderRadius: ACCOUNTS_TOKENS.radiusSm,
  background: "#fff",
  color: ACCOUNTS_TOKENS.ink,
  // Inset hairline gives the field a recessed, "fillable" feel.
  boxShadow: "inset 0 1px 2px rgba(15,23,42,0.05)",
  transition: "border-color 0.12s, box-shadow 0.12s",
};

// ── Page hero ──────────────────────────────────────────────────────

/** Page-level hero banner used at the top of every accounts surface.
 *  Replaces the old `record-head` for accounts pages to give them a
 *  more "section landing" feel. */
export function AccountsHero({
  title,
  description,
  badge,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Indigo tick — a small brand anchor that marks every
              finance surface without adding a row of height. */}
          <span
            aria-hidden
            style={{
              width: 4,
              height: 22,
              borderRadius: 2,
              background: `linear-gradient(180deg, ${ACCOUNTS_TOKENS.accent} 0%, #818cf8 100%)`,
              flexShrink: 0,
            }}
          />
          {/* Theme vars here on purpose — see the note in
              SectionHeader: this text sits on the page background. */}
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.025em",
            }}
          >
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

// ── Side panel (slide-over) ───────────────────────────────────────

/** Right-side slide-over drawer. Used for quick edits + bill detail
 *  side actions. Pure CSS animation, no library. */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
        animation: "fadeIn 0.15s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: ACCOUNTS_TOKENS.surface,
          color: ACCOUNTS_TOKENS.ink,
          width,
          maxWidth: "92vw",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(15, 23, 42, 0.18)",
          animation: "slideInRight 0.18s",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
            background: ACCOUNTS_TOKENS.headerGradient,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: ACCOUNTS_TOKENS.ink, letterSpacing: "-0.02em" }}>
              {title}
            </h2>
            {description && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: ACCOUNTS_TOKENS.inkMuted }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="acct-panel-close"
            style={{
              width: 30,
              height: 30,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              color: ACCOUNTS_TOKENS.inkMuted,
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>{children}</div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0 }
          to   { transform: translateX(0);    opacity: 1 }
        }
      `}</style>
    </div>
  );
}
