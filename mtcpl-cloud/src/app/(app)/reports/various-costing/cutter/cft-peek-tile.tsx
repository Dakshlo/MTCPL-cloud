"use client";

/**
 * Mig 063 follow-on (Daksh, May 2026) — clickable variant of the
 * CFT CUT KPI tile on the cutter cost report. Tap the tile → a
 * centred peek modal opens with every slab counted in the current
 * period (size code · from block · temple · stone · dimensions ·
 * CFT). Lets the user audit "where does this 2,588 CFT come from?".
 *
 * May 2026 follow-on (Daksh) — Detail / Summary toggle. The detail
 * view (original) is fine for short periods but unscannable at
 * weekly+. Summary view buckets the same contributingSlabs:
 *   • weekly  → 7 rows  (one per day Mon→Sun within the window)
 *   • monthly → up to 31 rows (one per day in the month)
 *   • yearly  → 12 rows (one per month)
 *   • daily   → no toggle (one bucket = the whole detail list)
 *
 * Tapping a summary row expands an inline detail strip showing
 * just that bucket's slabs — same columns as the full detail
 * view but filtered. Lets the user drill from "this week's CFT"
 * down to "what did we cut Tuesday?" without leaving the modal.
 *
 * Pure presentation — the slab list is computed server-side in
 * buildCutterCostReport() and passed in via props. Closing on
 * Escape + outside click. No deps beyond React.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CutterContributingSlab, CutterPeriodKind } from "@/lib/cutter-cost-report";

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ViewMode = "detail" | "summary";
/** Daksh — drill-down grouping mode. The user picks ONE level of
 *  grouping at a time (stone vs temple) instead of seeing both
 *  nested. Stone-wise is the default since cutter operators think
 *  stone-first. */
type GroupMode = "stone" | "temple";

/** A single bucket on the summary view. Period-kind dictates the
 *  shape: weekly/monthly → one bucket per day; yearly → one per month. */
type SummaryBucket = {
  /** Stable key — YYYY-MM-DD for day buckets, YYYY-MM for month buckets. */
  key: string;
  /** Display label — "Tue · 19 May" for days, "May 2026" for months. */
  label: string;
  /** Secondary hint shown to the right of the label, e.g. weekday or year. */
  hint: string;
  slabs: CutterContributingSlab[];
  cft: number;
  /** True when this bucket is "today" — gets a subtle highlight tint. */
  isToday: boolean;
};

export function CftPeekTile({
  totalCft,
  slabsCount,
  contributingSlabs,
  periodLabel,
  periodKind,
  periodStartDate,
  periodEndDate,
}: {
  totalCft: number;
  slabsCount: number;
  contributingSlabs: CutterContributingSlab[];
  periodLabel: string;
  /** Daksh May 2026 — period kind drives the summary-view bucketing.
   *  Daily skips the toggle entirely (one day = no summary value). */
  periodKind: CutterPeriodKind;
  /** YYYY-MM-DD inclusive bounds — used to seed empty-day rows so
   *  Tuesday with zero cuts still shows up as "Tue · 19 May · 0 slabs". */
  periodStartDate: string;
  periodEndDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Default to Summary on multi-day periods (the whole point of the
  // toggle — the detail view is the long table). Daily skips the
  // toggle altogether so we leave it on Detail.
  const [view, setView] = useState<ViewMode>(
    periodKind === "daily" ? "detail" : "summary",
  );
  // Which summary bucket is expanded into an inline detail strip.
  // null = nothing expanded; just the bucket rows are visible.
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  // Drill-down grouping. Persisted across bucket switches so flipping
  // Mon → Tue keeps your preferred grouping.
  const [groupMode, setGroupMode] = useState<GroupMode>("stone");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset expanded bucket whenever the modal opens or view flips —
  // stale expansion across re-opens would look weird.
  useEffect(() => {
    if (!open) setExpandedBucket(null);
  }, [open]);
  useEffect(() => {
    setExpandedBucket(null);
  }, [view]);

  // Summary buckets — re-computed only when slabs / bounds change.
  // We bucket on the IST date of the slab's updated_at so the bucket
  // matches what the user sees in Ready Sizes (also IST). For yearly
  // we collapse all 365 days into 12 month buckets.
  const buckets = useMemo<SummaryBucket[]>(() => {
    if (periodKind === "daily") return [];
    return bucketSlabs(contributingSlabs, periodKind, periodStartDate, periodEndDate);
  }, [contributingSlabs, periodKind, periodStartDate, periodEndDate]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view every slab counted in this period"
        style={{
          position: "relative",
          padding: "16px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
          transition: "transform 0.12s, box-shadow 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow =
            "0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "#10b981",
          }}
        />
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>CFT Cut</span>
          <span style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 700 }}>
            ⌕ View slabs
          </span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
          {fmtNum(totalCft)}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {slabsCount} slab{slabsCount === 1 ? "" : "s"} counted
        </div>
      </button>

      {open && mounted &&
        createPortal(
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.55)",
              display: "grid",
              placeItems: "center",
              padding: "24px 16px",
              zIndex: 200,
              animation: "cftFade 0.15s",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: 14,
                width: "92%",
                maxWidth: 980,
                maxHeight: "85vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 24px 64px rgba(15,23,42,0.25)",
                animation: "cftScaleIn 0.15s ease-out",
              }}
            >
              <div
                style={{
                  padding: "18px 22px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Slabs counted · {periodLabel}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                    {slabsCount} slab{slabsCount === 1 ? "" : "s"} ·{" "}
                    <span style={{ fontFamily: "ui-monospace, monospace" }}>{fmtNum(totalCft)} CFT</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Status post-cut · updated_at within the selected window
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Daksh May 2026 — Detail / Summary toggle. Hidden
                      on daily because one day collapses to itself. */}
                  {periodKind !== "daily" && (
                    <div
                      role="tablist"
                      aria-label="View mode"
                      style={{
                        display: "inline-flex",
                        background: "#f1f5f9",
                        borderRadius: 999,
                        padding: 3,
                        gap: 2,
                      }}
                    >
                      <ToggleBtn
                        active={view === "summary"}
                        onClick={() => setView("summary")}
                        label="Summary"
                      />
                      <ToggleBtn
                        active={view === "detail"}
                        onClick={() => setView("detail")}
                        label="Detail"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{
                      padding: "6px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      background: "#f1f5f9",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    Esc · Close
                  </button>
                </div>
              </div>

              <div style={{ overflow: "auto", padding: "8px 0" }}>
                {contributingSlabs.length === 0 ? (
                  <div
                    style={{
                      padding: 48,
                      textAlign: "center",
                      color: "#64748b",
                      fontSize: 14,
                    }}
                  >
                    No slabs were cut in this period.
                  </div>
                ) : view === "detail" ? (
                  <DetailTable slabs={contributingSlabs} totalCft={totalCft} showTotal />
                ) : (
                  <SummaryTable
                    buckets={buckets}
                    periodKind={periodKind}
                    totalCft={totalCft}
                    totalSlabs={slabsCount}
                    expandedKey={expandedBucket}
                    onToggle={(key) =>
                      setExpandedBucket((prev) => (prev === key ? null : key))
                    }
                    groupMode={groupMode}
                    onGroupModeChange={setGroupMode}
                  />
                )}
              </div>
            </div>

            <style>{`
              @keyframes cftFade { from { opacity: 0 } to { opacity: 1 } }
              @keyframes cftScaleIn {
                from { opacity: 0; transform: scale(0.96) }
                to   { opacity: 1; transform: scale(1) }
              }
            `}</style>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Detail table — the original full slab list ────────────────────

function DetailTable({
  slabs,
  totalCft,
  showTotal,
}: {
  slabs: CutterContributingSlab[];
  totalCft: number;
  showTotal: boolean;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
          <th style={th()}>Size Code</th>
          <th style={th()}>From Block</th>
          <th style={th()}>Temple</th>
          <th style={th()}>Label</th>
          <th style={th()}>Stone</th>
          <th style={{ ...th(), textAlign: "right" }}>Dimensions (in)</th>
          <th style={{ ...th(), textAlign: "right" }}>CFT</th>
        </tr>
      </thead>
      <tbody>
        {slabs.map((s) => (
          <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
            <td style={{ ...td(), fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{s.id}</td>
            <td style={{ ...td(), fontFamily: "ui-monospace, monospace", color: "#b45309" }}>
              {s.sourceBlockId ?? "—"}
            </td>
            <td style={td()}>{s.temple ?? "—"}</td>
            <td style={td()}>{s.label ?? "—"}</td>
            <td style={{ ...td(), color: "#64748b" }}>{s.stone ?? "—"}</td>
            <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
              {fmtNum(s.lengthIn, 0)}{"× "}
              {fmtNum(s.widthIn, 0)}{"× "}
              {fmtNum(s.thicknessIn, 0)}
            </td>
            <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
              {fmtNum(s.cft, 2)}
            </td>
          </tr>
        ))}
      </tbody>
      {showTotal && (
        <tfoot>
          <tr style={{ background: "#fffbeb", borderTop: "2px solid #d97706" }}>
            <td style={{ ...td(), fontWeight: 800 }} colSpan={6}>
              Total
            </td>
            <td
              style={{
                ...td(),
                textAlign: "right",
                fontFamily: "ui-monospace, monospace",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              {fmtNum(totalCft, 2)} CFT
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// ── Grouped detail (single level: stone OR temple) ────────────────
//
// Daksh — the bucket drill-down groups slabs by ONE dimension at a
// time (operator picks via the toggle above the table). Stone-wise
// answers "what did we cut out of PinkStone Tuesday?"; temple-wise
// answers "which temple drove Tuesday's CFT?". Showing both
// nested at once (the previous iteration) was visually noisy;
// flipping a single toggle is faster than scanning a 2-level tree.
//
// Sort: groups by CFT desc (biggest contributor first), slabs
// within a group by CFT desc.

function GroupedDetailTable({
  slabs,
  groupBy,
}: {
  slabs: CutterContributingSlab[];
  groupBy: GroupMode;
}) {
  type Group = {
    key: string;
    rows: CutterContributingSlab[];
    cft: number;
  };

  // Bucket by the chosen dimension. Nulls coerce to "—" so they
  // don't disappear; matches the flat Detail view convention.
  const byKey = new Map<string, CutterContributingSlab[]>();
  for (const s of slabs) {
    const key = (groupBy === "stone" ? s.stone : s.temple) ?? "—";
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
  }
  const groups: Group[] = [];
  for (const [key, rows] of byKey) {
    const sortedRows = [...rows].sort((a, b) => (b.cft || 0) - (a.cft || 0));
    const cft = sortedRows.reduce((acc, s) => acc + (s.cft || 0), 0);
    groups.push({ key, rows: sortedRows, cft });
  }
  groups.sort((a, b) => b.cft - a.cft);

  // Style tokens for the group header. Stone-wise gets a sky tint,
  // temple-wise an amber tint — keeps the visual cue consistent
  // even after flipping the toggle.
  const headerStyle = groupBy === "stone"
    ? {
        bg: "#e0f2fe",
        border: "#0284c7",
        fg: "#0c4a6e",
        accent: "#0369a1",
        icon: "💎",
      }
    : {
        bg: "#fef3c7",
        border: "#d97706",
        fg: "#78350f",
        accent: "#92400e",
        icon: "🏛",
      };

  // In stone-wise mode the slab row keeps its temple column (so the
  // user can see "PinkStone → Temple X"); in temple-wise mode the
  // slab row keeps its stone column instead. Five columns either way.
  const secondaryHeader = groupBy === "stone" ? "Temple" : "Stone";

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
          <th style={th()}>Size Code</th>
          <th style={th()}>From Block</th>
          <th style={th()}>{secondaryHeader}</th>
          <th style={{ ...th(), textAlign: "right" }}>Dimensions (in)</th>
          <th style={{ ...th(), textAlign: "right" }}>CFT</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={`${groupBy}:${g.key}`}>
            <tr style={{ background: headerStyle.bg, borderTop: `2px solid ${headerStyle.border}` }}>
              <td
                colSpan={5}
                style={{
                  padding: "10px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: headerStyle.fg,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                <span>{headerStyle.icon} {g.key}</span>
                <span
                  style={{
                    marginLeft: 10,
                    color: headerStyle.accent,
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: "none",
                    letterSpacing: "0.02em",
                  }}
                >
                  · {g.rows.length} slab{g.rows.length === 1 ? "" : "s"}
                </span>
                <span
                  style={{
                    float: "right",
                    fontSize: 12,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 800,
                    color: headerStyle.fg,
                  }}
                >
                  {fmtNum(g.cft, 2)} CFT
                </span>
              </td>
            </tr>
            {g.rows.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9", background: "#fff" }}>
                <td
                  style={{
                    ...td(),
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                    paddingLeft: 28,
                  }}
                >
                  {s.id}
                </td>
                <td style={{ ...td(), fontFamily: "ui-monospace, monospace", color: "#b45309" }}>
                  {s.sourceBlockId ?? "—"}
                </td>
                <td style={{ ...td(), color: groupBy === "stone" ? "#0f172a" : "#64748b" }}>
                  {(groupBy === "stone" ? s.temple : s.stone) ?? "—"}
                </td>
                <td
                  style={{
                    ...td(),
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {fmtNum(s.lengthIn, 0)}{"× "}
                  {fmtNum(s.widthIn, 0)}{"× "}
                  {fmtNum(s.thicknessIn, 0)}
                </td>
                <td
                  style={{
                    ...td(),
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                  }}
                >
                  {fmtNum(s.cft, 2)}
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ── Summary table — day-bucket or month-bucket rows ───────────────

function SummaryTable({
  buckets,
  periodKind,
  totalCft,
  totalSlabs,
  expandedKey,
  onToggle,
  groupMode,
  onGroupModeChange,
}: {
  buckets: SummaryBucket[];
  periodKind: CutterPeriodKind;
  totalCft: number;
  totalSlabs: number;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
}) {
  const bucketLabel = periodKind === "yearly" ? "Month" : "Day";
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
          <th style={{ ...th(), width: 28 }}></th>
          <th style={th()}>{bucketLabel}</th>
          <th style={{ ...th(), textAlign: "right" }}>Slabs</th>
          <th style={{ ...th(), textAlign: "right" }}>CFT</th>
          <th style={{ ...th(), textAlign: "right", width: 70 }}></th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => {
          const isOpen = expandedKey === b.key;
          const hasSlabs = b.slabs.length > 0;
          return (
            <Fragment key={b.key}>
              <tr
                onClick={() => {
                  if (hasSlabs) onToggle(b.key);
                }}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  cursor: hasSlabs ? "pointer" : "default",
                  background: b.isToday ? "#fefce8" : isOpen ? "#eff6ff" : undefined,
                  opacity: hasSlabs ? 1 : 0.55,
                }}
                title={
                  hasSlabs
                    ? isOpen
                      ? "Tap to collapse"
                      : "Tap to see this period's slabs"
                    : "No cuts this period"
                }
              >
                <td style={{ ...td(), textAlign: "center", color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                  {hasSlabs ? (isOpen ? "▼" : "▶") : "·"}
                </td>
                <td style={{ ...td(), fontWeight: 700 }}>
                  {b.label}
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
                    {b.hint}
                  </span>
                  {b.isToday && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#854d0e",
                        background: "#fef9c3",
                        padding: "2px 6px",
                        borderRadius: 4,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      Today
                    </span>
                  )}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {b.slabs.length}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                  {fmtNum(b.cft, 2)}
                </td>
                <td style={{ ...td(), textAlign: "right" }}>
                  {hasSlabs && (
                    <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>
                      {isOpen ? "Hide" : "View"}
                    </span>
                  )}
                </td>
              </tr>
              {isOpen && hasSlabs && (
                <tr>
                  <td colSpan={5} style={{ padding: 0, background: "#f8fafc" }}>
                    <div style={{ padding: "10px 16px 16px", background: "#f8fafc" }}>
                      {/* Daksh — Stone-wise / Temple-wise toggle for
                          the drill-down. Single level of grouping at a
                          time; flip to see the other view. */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          Group by
                        </span>
                        <div
                          role="tablist"
                          aria-label="Drill-down grouping"
                          style={{
                            display: "inline-flex",
                            background: "#e2e8f0",
                            borderRadius: 999,
                            padding: 3,
                            gap: 2,
                          }}
                        >
                          <ToggleBtn
                            active={groupMode === "stone"}
                            onClick={() => onGroupModeChange("stone")}
                            label="💎 Stone-wise"
                          />
                          <ToggleBtn
                            active={groupMode === "temple"}
                            onClick={() => onGroupModeChange("temple")}
                            label="🏛 Temple-wise"
                          />
                        </div>
                      </div>
                      <GroupedDetailTable slabs={b.slabs} groupBy={groupMode} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot>
        <tr style={{ background: "#fffbeb", borderTop: "2px solid #d97706" }}>
          <td style={td()}></td>
          <td style={{ ...td(), fontWeight: 800 }}>Total</td>
          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
            {totalSlabs}
          </td>
          <td
            style={{
              ...td(),
              textAlign: "right",
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {fmtNum(totalCft, 2)} CFT
          </td>
          <td style={td()}></td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Bucketing helpers ─────────────────────────────────────────────

/** Build summary buckets for a given period kind. The slab list is
 *  bucketed by the IST calendar date of updated_at (yearly collapses
 *  further to month). Empty buckets are still emitted so a runner
 *  scanning weekly sees "Tue · 0 slabs" instead of a missing row. */
function bucketSlabs(
  slabs: CutterContributingSlab[],
  kind: CutterPeriodKind,
  startDate: string,
  endDate: string,
): SummaryBucket[] {
  // IST-based YYYY-MM-DD key for a slab.
  function dayKeyIST(iso: string): string {
    const d = new Date(iso);
    // toLocaleString → "DD/MM/YYYY, HH:MM:SS am" in en-IN. Easier to
    // pull components via Intl parts.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${day}`;
  }
  function monthKeyFromDay(dayKey: string): string {
    return dayKey.slice(0, 7); // YYYY-MM
  }

  // Today in IST — used to flag "is this bucket today?".
  const todayKey = (() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${day}`;
  })();
  const todayMonthKey = todayKey.slice(0, 7);

  // 1. Build the empty skeleton (every day or every month in range).
  type Skeleton = { key: string; date: Date };
  const skeleton: Skeleton[] = [];
  if (kind === "yearly") {
    // 12 months from startDate's year-month → endDate's year-month.
    const start = new Date(`${startDate}T00:00:00+05:30`);
    const end = new Date(`${endDate}T00:00:00+05:30`);
    const y0 = start.getFullYear();
    const m0 = start.getMonth();
    const y1 = end.getFullYear();
    const m1 = end.getMonth();
    let yy = y0;
    let mm = m0;
    while (yy < y1 || (yy === y1 && mm <= m1)) {
      const key = `${yy}-${String(mm + 1).padStart(2, "0")}`;
      skeleton.push({ key, date: new Date(yy, mm, 1) });
      mm += 1;
      if (mm === 12) {
        mm = 0;
        yy += 1;
      }
    }
  } else {
    // weekly / monthly → one row per day in [startDate, endDate].
    const start = new Date(`${startDate}T00:00:00+05:30`);
    const end = new Date(`${endDate}T00:00:00+05:30`);
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      const key = dayKeyIST(cursor.toISOString());
      skeleton.push({ key, date: new Date(cursor) });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // 2. Group slabs by key.
  const slabsByKey = new Map<string, CutterContributingSlab[]>();
  for (const s of slabs) {
    const dayKey = dayKeyIST(s.updatedAt);
    const key = kind === "yearly" ? monthKeyFromDay(dayKey) : dayKey;
    const arr = slabsByKey.get(key);
    if (arr) arr.push(s);
    else slabsByKey.set(key, [s]);
  }

  // 3. Assemble.
  return skeleton.map((row) => {
    const bucketSlabs = slabsByKey.get(row.key) ?? [];
    const cft = bucketSlabs.reduce((acc, s) => acc + (s.cft || 0), 0);
    let label: string;
    let hint: string;
    let isToday = false;
    if (kind === "yearly") {
      // Label from the IST key (YYYY-MM), NOT the host-local row.date.
      const [y, m] = row.key.split("-");
      label = `${MONTH_SHORT[Number(m) - 1]} ${y}`;
      hint = "";
      isToday = row.key === todayMonthKey;
    } else {
      // Daksh (Jun 2026) — numeric DD/MM/YYYY built from the IST key.
      // (row.date is an IST-midnight instant; on a UTC server its getDate()
      // returns the PRIOR day, which shifted every label −1 day.)
      const [y, m, d] = row.key.split("-");
      label = `${d}/${m}/${y}`;
      hint = "";
      isToday = row.key === todayKey;
    }
    // Sort slabs inside a bucket by CFT desc so the highest-impact
    // pieces lead the drill-down list.
    bucketSlabs.sort((a, b) => (b.cft || 0) - (a.cft || 0));
    return { key: row.key, label, hint, slabs: bucketSlabs, cft, isToday };
  });
}

// ── Tiny UI helpers ───────────────────────────────────────────────

function ToggleBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? "#fff" : "transparent",
        color: active ? "#0f172a" : "#64748b",
        border: "none",
        borderRadius: 999,
        cursor: active ? "default" : "pointer",
        boxShadow: active ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function th(): React.CSSProperties {
  return {
    padding: "10px 14px",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    textAlign: "left",
  };
}

function td(): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    color: "#0f172a",
  };
}
