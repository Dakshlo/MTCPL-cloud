// Shared UI primitives for the Accounts module.
//
// Visual language: Zoho Books / FreshBooks — clean whitespace, soft
// indigo accents, monospace for amounts, vendor avatars with
// deterministic initials, big readable KPIs.
//
// The accounts module overlays its own accent palette on top of the
// app's gold/cream theme so the finance surfaces feel like a
// distinct section without breaking the overall design language.

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
  border: "#e2e8f0",        // slate-200
  borderStrong: "#cbd5e1",  // slate-300
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",  // slate-50
  shadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
  shadowLarge: "0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)",
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
 *  Use `size="hero"` for big numbers on hero blocks and KPI cards. */
export function Money({
  value,
  size = "normal",
  tone,
  prefix = "₹",
}: {
  value: number;
  size?: "hero" | "large" | "normal" | "small";
  tone?: "success" | "warning" | "danger" | "muted" | "accent";
  prefix?: string;
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
    muted: "var(--muted)",
    accent: ACCOUNTS_TOKENS.accent,
  };
  return (
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: tone ? tones[tone] : "var(--text)",
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
        ...sizes[size],
      }}
    >
      {prefix}
      {value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
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
        <strong style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </strong>
        {subLabel && (
          <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {subLabel}
          </span>
        )}
      </span>
    </span>
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
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tint.dot,
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
    neutral: { accent: ACCOUNTS_TOKENS.neutral, bg: "transparent" },
    accent:  { accent: ACCOUNTS_TOKENS.accent, bg: ACCOUNTS_TOKENS.accentLight },
    success: { accent: ACCOUNTS_TOKENS.success, bg: ACCOUNTS_TOKENS.successLight },
    warning: { accent: ACCOUNTS_TOKENS.warning, bg: ACCOUNTS_TOKENS.warningLight },
    danger:  { accent: ACCOUNTS_TOKENS.danger, bg: ACCOUNTS_TOKENS.dangerLight },
  };
  const t = toneStyles[tone];

  const body = (
    <div
      style={{
        padding: "16px 18px",
        background: "var(--surface, #fff)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: t.accent,
          opacity: 0.85,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            {label}
          </div>
          <div style={{ wordBreak: "break-word" }}>{value}</div>
          {sublabel && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              {sublabel}
            </div>
          )}
        </div>
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: t.bg,
              color: t.accent,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
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
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.6 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 420, margin: "0 auto" }}>
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        {description && (
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>{description}</p>
        )}
      </div>
      {typeof count === "number" && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>{count}</strong>
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
  table: {
    width: "100%",
    borderCollapse: "separate" as const,
    borderSpacing: 0,
    fontSize: 12,
  },
  thead: {
    background: ACCOUNTS_TOKENS.surfaceMuted,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 10px",
    fontSize: 10,
    fontWeight: 700,
    color: ACCOUNTS_TOKENS.neutral,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
    whiteSpace: "nowrap" as const,
  },
  thRight: {
    textAlign: "right" as const,
    padding: "8px 10px",
    fontSize: 10,
    fontWeight: 700,
    color: ACCOUNTS_TOKENS.neutral,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
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
    background: "var(--surface, #fff)",
    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
    borderRadius: 12,
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
    background: ACCOUNTS_TOKENS.accent,
    color: "#fff",
    border: "1px solid transparent",
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    letterSpacing: "-0.005em",
    boxShadow: "0 1px 2px rgba(79,70,229,0.18)",
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
    background: "#fff",
    color: "var(--text)",
    border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
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
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
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
    color: "var(--muted)",
    border: `1px dashed ${ACCOUNTS_TOKENS.borderStrong}`,
    borderRadius: 8,
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
  borderRadius: 8,
  background: "#fff",
  color: "var(--text)",
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
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
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
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
        animation: "fadeIn 0.15s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface, #fff)",
          width,
          maxWidth: "92vw",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.12)",
          animation: "slideInRight 0.18s",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
              {title}
            </h2>
            {description && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              width: 30,
              height: 30,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--muted)",
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
