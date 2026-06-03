"use client";

/**
 * Shared sticky month-context bar for the two expense-entry pages
 * (/carving/expenses = CNC, /cutting/expenses = Cutter).
 *
 * Why this exists (Daksh, June 2026): the old pages had a month
 * dropdown + "View" button at the TOP-RIGHT and a separate prev/next
 * nav at the BOTTOM. The two controls disagreed visually, and — worst
 * of all — changing the dropdown without pressing "View" left the
 * page still editing the OLD month. People were entering a month's
 * bills into the wrong month.
 *
 * This single control fixes that:
 *   • One bar, pinned under the topbar, always visible while scrolling.
 *   • The month/year dropdowns AUTO-NAVIGATE on change (no stale
 *     selection possible — the page reloads to the picked month).
 *   • A status pill (Current / Past / Future) + a coloured left accent
 *     so you always know whether you're on the live month.
 *   • A loud banner + one-click "switch to current" whenever you're
 *     NOT on the current month — the single biggest guard against
 *     entering bills into the wrong month.
 *
 * Presentation only — it just navigates via query params; all the
 * data/server-action plumbing is untouched.
 */

import { useRouter } from "next/navigation";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

type Relation = "current" | "past" | "future";

export function ExpenseMonthBar({
  basePath,
  kicker,
  year,
  month,
  currentYear,
  currentMonth,
  total,
  totalCaption,
}: {
  /** Route the month nav rewrites, e.g. "/carving/expenses". */
  basePath: string;
  /** Small uppercase label above the month, e.g. "CNC Operational Expenses". */
  kicker: string;
  /** Currently-viewed month (1-12) + year. */
  year: number;
  month: number;
  /** Today's IST month (1-12) + year — used for the Current/Past/Future state. */
  currentYear: number;
  currentMonth: number;
  /** Running total shown on the right of the bar. */
  total: number;
  totalCaption?: string;
}) {
  const router = useRouter();
  const go = (y: number, m: number) =>
    router.push(`${basePath}?year=${y}&month=${pad2(m)}`);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  const viewingIdx = year * 12 + (month - 1);
  const currentIdx = currentYear * 12 + (currentMonth - 1);
  const rel: Relation =
    viewingIdx === currentIdx ? "current" : viewingIdx < currentIdx ? "past" : "future";

  // Year dropdown options — last year … next year, plus the viewed
  // year if it falls outside that window (so it's always selectable).
  const yearOptions = Array.from(
    new Set([currentYear - 1, currentYear, currentYear + 1, year]),
  ).sort((a, b) => a - b);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const currentLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

  const accent =
    rel === "current" ? "#15803d" : rel === "past" ? "#b45309" : "#1d4ed8";
  const pill =
    rel === "current"
      ? { bg: "#dcfce7", fg: "#15803d", label: "● Current month" }
      : rel === "past"
        ? { bg: "#fde9c8", fg: "#92400e", label: "◀ Past month" }
        : { bg: "#dbeafe", fg: "#1e40af", label: "▶ Future month" };

  return (
    <>
      {/* ── Sticky month control ─────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 56, // sits flush under the 56px app topbar
          zIndex: 40,
          marginBottom: rel === "current" ? 16 : 10,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderLeft: `5px solid ${accent}`,
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
          boxShadow: "0 6px 18px rgba(0,0,0,0.07)",
        }}
      >
        {/* Prev · MONTH · Next */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            aria-label="Previous month"
            title={`${MONTH_NAMES[prev.m - 1]} ${prev.y}`}
            onClick={() => go(prev.y, prev.m)}
            style={chevBtn()}
          >
            ‹
          </button>
          <div style={{ minWidth: 150, textAlign: "center" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted)",
                lineHeight: 1.2,
              }}
            >
              {kicker}
            </div>
            <div
              style={{
                fontSize: 25,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              {monthLabel}
            </div>
          </div>
          <button
            type="button"
            aria-label="Next month"
            title={`${MONTH_NAMES[next.m - 1]} ${next.y}`}
            onClick={() => go(next.y, next.m)}
            style={chevBtn()}
          >
            ›
          </button>
        </div>

        {/* Status pill */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
            background: pill.bg,
            color: pill.fg,
            whiteSpace: "nowrap",
          }}
        >
          {pill.label}
        </span>

        {rel !== "current" && (
          <button
            type="button"
            onClick={() => go(currentYear, currentMonth)}
            style={ghostBtn(accent)}
          >
            Go to {currentLabel} →
          </button>
        )}

        {/* Jump + total — pushed to the right */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Jump&nbsp;to
            <select
              aria-label="Jump to month"
              value={month}
              onChange={(e) => go(year, Number(e.target.value))}
              style={jumpSelect()}
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              aria-label="Jump to year"
              value={year}
              onChange={(e) => go(Number(e.target.value), month)}
              style={jumpSelect()}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div style={{ textAlign: "right", minWidth: 92 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Month total
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                fontFamily: "ui-monospace, monospace",
                color: total > 0 ? "var(--gold-dark)" : "var(--muted)",
                lineHeight: 1.1,
              }}
            >
              {fmtINR(total)}
            </div>
            {totalCaption && (
              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                {totalCaption}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Non-current warning banner (scrolls away; the pill above
            keeps the persistent signal while pinned) ─────────────── */}
      {rel !== "current" && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "11px 15px",
            borderRadius: 10,
            background: rel === "past" ? "#fffbeb" : "#eff6ff",
            border: `1.5px solid ${rel === "past" ? "#f59e0b" : "#3b82f6"}`,
            color: rel === "past" ? "#92400e" : "#1e3a8a",
            fontSize: 13.5,
          }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>
            {rel === "past" ? "⚠️" : "📅"}
          </span>
          <span style={{ flex: 1, minWidth: 240 }}>
            You&apos;re entering expenses into <strong>{monthLabel}</strong> — a{" "}
            {rel === "past" ? "PAST" : "FUTURE"} month. Today is{" "}
            <strong>{currentLabel}</strong>. Make sure this is the month you
            mean before adding any bills.
          </span>
          <button
            type="button"
            onClick={() => go(currentYear, currentMonth)}
            style={solidBtn(rel === "past" ? "#b45309" : "#1d4ed8")}
          >
            Switch to {currentLabel}
          </button>
        </div>
      )}
    </>
  );
}

function chevBtn(): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    flexShrink: 0,
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1,
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    cursor: "pointer",
  };
}

function jumpSelect(): React.CSSProperties {
  return {
    padding: "7px 9px",
    fontSize: 13,
    fontWeight: 600,
    background: "#fff",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    textTransform: "none",
    letterSpacing: "normal",
  };
}

function ghostBtn(color: string): React.CSSProperties {
  return {
    padding: "7px 13px",
    fontSize: 12.5,
    fontWeight: 700,
    background: "transparent",
    color,
    border: `1.5px solid ${color}`,
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function solidBtn(color: string): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    background: color,
    color: "#fff",
    border: `1px solid ${color}`,
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
