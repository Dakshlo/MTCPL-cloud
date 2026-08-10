"use client";

/**
 * Cross-vendor royalty summary — passphrase-gated.
 *
 * Three-stage UX:
 *   1. Locked: enter passphrase (same 125500 as Royalty Approval).
 *   2. Unlocked: pick date range + granularity (Day / Week / Month).
 *      Auto-loads with sensible defaults (current month, daily).
 *   3. Results: totals tiles + bucket table + per-vendor table.
 *
 * Aug 2026 makeover (Daksh): same premium language as the costing
 * pages — elevated cards, tone-tinted stat tiles, segmented control,
 * gold accent-bar panel headers — with every colour theme-safe (the
 * old build hardcoded light hexes that went light-on-light in dark
 * mode). Layout order unchanged. Per-vendor rows now show WHEN the
 * entries happened: a date line under each vendor plus click-to-
 * expand per-entry rows (date · direction · amount).
 *
 * "Royalty points" not rupees — same convention as the rest of
 * the royalty surfaces (see fmtPoints in royalty-approvals-client).
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

type RoyaltyEntry = {
  date: string;
  type: "received" | "given";
  amount: number;
};

type VendorBreakdown = {
  id: string;
  name: string;
  received: number;
  given: number;
  net: number;
  entryCount: number;
  /** Individual entries (chronological). Present on the range-wide
   *  per-vendor list; bucket-level breakdowns come back empty. */
  entries?: RoyaltyEntry[];
};

type SummaryResult =
  | {
      ok: true;
      buckets: Array<{
        key: string;
        label: string;
        rangeStart: string;
        rangeEnd: string;
        received: number;
        given: number;
        net: number;
        entryCount: number;
        vendors: VendorBreakdown[];
      }>;
      totals: {
        received: number;
        given: number;
        net: number;
        entryCount: number;
      };
      vendors: VendorBreakdown[];
    }
  | { ok: false; error: string };

type Granularity = "day" | "week" | "month";

function fmtPoints(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Aug 2026" for a single ISO date. */
function fmtDate(iso: string): string {
  const p = iso.split("-").map(Number);
  if (p.length !== 3) return iso;
  return `${p[2]} ${MON[p[1] - 1]} ${p[0]}`;
}

/** "2 Jul – 22 Jul 2026" for a span, or "15 Jul 2026" when both ends
 *  are the same day. Powers the date line on Week / Month / vendor rows. */
function fmtDateRange(startIso: string, endIso: string): string {
  const s = startIso.split("-").map(Number); // [y, m, d]
  const e = endIso.split("-").map(Number);
  if (s.length !== 3 || e.length !== 3) return "";
  const one = (a: number[]) => `${a[2]} ${MON[a[1] - 1]} ${a[0]}`;
  if (startIso === endIso) return one(s);
  // Same year → don't repeat it on the left side.
  const left = s[0] === e[0] ? `${s[2]} ${MON[s[1] - 1]}` : one(s);
  return `${left} – ${one(e)}`;
}

/** YYYY-MM-DD for today in IST. Defaults the date picker. */
function todayIstYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** First day of the current month (IST) — sensible default for the
 *  "From" picker on monthly view. */
function firstOfMonthIstYmd(): string {
  return todayIstYmd().slice(0, 7) + "-01";
}

// ── Shared visual bits (same language as the costing-page kit) ──────

const cardShell: React.CSSProperties = {
  position: "relative",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 6px 20px rgba(0,0,0,0.045)",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

/** Scoped theme-safe tone vars + row hover. The semantic colours
 *  (received = green, given = amber) need DIFFERENT shades per theme
 *  to stay readable, so they live as CSS vars flipped by data-theme. */
function RsxStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.rsx { --rsx-green:#15803d; --rsx-amber:#b45309; --rsx-red:#b91c1c; }
[data-theme="dark"] .rsx { --rsx-green:#4ade80; --rsx-amber:#fbbf24; --rsx-red:#f87171; }
.rsx tbody tr { transition: background .12s ease; }
.rsx tr.rsx-click { cursor: pointer; }
.rsx tr.rsx-click:hover { background: rgba(232,197,114,0.12); }
`,
      }}
    />
  );
}

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "13px 18px",
        borderBottom: "1px solid var(--border)",
        background: "linear-gradient(180deg, var(--surface-alt), var(--surface))",
        ...eyebrowStyle,
      }}
    >
      <span style={{ width: 5, height: 15, borderRadius: 3, background: "var(--gold)", flexShrink: 0 }} />
      {children}
    </div>
  );
}

/** Stat tile — accent dot + soft corner glow + fading top strip. */
function StatTile({
  label,
  value,
  caption,
  tone,
  fg,
}: {
  label: string;
  value: string;
  caption?: string;
  tone: { main: string; glow: string };
  /** Colour for the big value — defaults to the theme text colour. */
  fg?: string;
}) {
  return (
    <div style={{ ...cardShell, padding: "16px 18px" }}>
      <div
        style={{
          position: "absolute",
          right: -34,
          top: -34,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: tone.glow,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          background: `linear-gradient(90deg, ${tone.main}, transparent 78%)`,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 3,
            background: tone.main,
            boxShadow: `0 0 0 3px ${tone.glow}`,
            flexShrink: 0,
          }}
        />
        <div style={eyebrowStyle}>{label}</div>
      </div>
      <div
        style={{
          fontSize: 25,
          fontWeight: 800,
          color: fg ?? "var(--text)",
          letterSpacing: "-0.02em",
          marginTop: 9,
          fontFamily: "ui-monospace, monospace",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {caption && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, fontWeight: 600 }}>
          {caption}
        </div>
      )}
    </div>
  );
}

export function RoyaltySummaryClient({
  summaryAction,
}: {
  summaryAction: (fd: FormData) => Promise<SummaryResult>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filters. For Day mode we collapse to a single date — both
  // from/to track the same value so the existing server contract
  // (date range) stays simple. For Week/Month we expose From/To.
  const [fromDate, setFromDate] = useState<string>(todayIstYmd());
  const [toDate, setToDate] = useState<string>(todayIstYmd());
  const [granularity, setGranularity] = useState<Granularity>("day");

  // Which bucket row is expanded to show its per-vendor breakdown.
  // null = none expanded. Reset whenever filters change.
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(
    null,
  );
  // Which vendor row (range-wide table) is expanded to its entries.
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(
    null,
  );

  // Result
  const [result, setResult] = useState<
    Extract<SummaryResult, { ok: true }> | null
  >(null);

  /** Fire the summary query with current filters. Used after unlock
   *  AND any time a filter changes. */
  function fetchSummary() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("passphrase", passphrase);
      fd.set("from_date", fromDate);
      fd.set("to_date", toDate);
      fd.set("granularity", granularity);
      const r = await summaryAction(fd);
      if (!r.ok) {
        setError(r.error);
        // If passphrase failed, drop the unlock so the user sees the
        // entry form again with the inline error.
        if (r.error.toLowerCase().includes("passphrase")) {
          setUnlocked(false);
        }
        return;
      }
      setResult(r);
    });
  }

  // When user flips to Day mode, collapse the range to a single day
  // (the "To" value) so the picker shows one input. When flipping to
  // Week / Month, expand to "this month so far" — a useful default.
  useEffect(() => {
    if (granularity === "day") {
      if (fromDate !== toDate) setFromDate(toDate);
    } else {
      if (fromDate === toDate) setFromDate(firstOfMonthIstYmd());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  // Collapse any expanded row when the data set changes.
  useEffect(() => {
    setExpandedBucketKey(null);
    setExpandedVendorId(null);
  }, [fromDate, toDate, granularity]);

  // Re-fetch when granularity / date range changes after unlock.
  useEffect(() => {
    if (!unlocked) return;
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, granularity, unlocked]);

  function handleUnlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!passphrase) {
      setError("Enter the passphrase.");
      return;
    }
    // Trigger initial fetch — the useEffect above will catch
    // subsequent filter changes.
    startTransition(async () => {
      const fd = new FormData();
      fd.set("passphrase", passphrase);
      fd.set("from_date", fromDate);
      fd.set("to_date", toDate);
      fd.set("granularity", granularity);
      const r = await summaryAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setUnlocked(true);
      setResult(r);
    });
  }

  // Net tone — direction-aware accent for the Net tile + totals.
  const netTone = useMemo(() => {
    const n = result?.totals.net ?? 0;
    if (n > 0.5)
      return {
        tile: { main: "#f59e0b", glow: "rgba(245,158,11,0.15)" },
        fg: "var(--rsx-amber)",
        icon: "↗",
        caption: "We paid net to vendors",
      };
    if (n < -0.5)
      return {
        tile: { main: "#10b981", glow: "rgba(16,185,129,0.15)" },
        fg: "var(--rsx-green)",
        icon: "↘",
        caption: "Vendors paid net to us",
      };
    return {
      tile: { main: "#94a3b8", glow: "rgba(148,163,184,0.14)" },
      fg: "var(--muted)",
      icon: "·",
      caption: "Even — no net direction",
    };
  }, [result]);

  const errorBanner = error && (
    <div
      role="alert"
      style={{
        padding: "9px 13px",
        background: "rgba(239,68,68,0.12)",
        border: "1px solid rgba(239,68,68,0.45)",
        color: "var(--rsx-red)",
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {error}
    </div>
  );

  return (
    <section className="page-card rsx">
      <RsxStyles />
      <FinanceLoadingOverlay show={pending} label="Loading royalty summary…" />
      <header style={{ marginBottom: 22 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--gold-dark)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Owner View
        </div>
        <h1 style={{ margin: "2px 0", fontSize: 25, fontWeight: 800, letterSpacing: "-0.015em" }}>
          🏷️ Royalty Summary
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", maxWidth: 760 }}>
          Cross-vendor flow of approved royalty entries. Pick a date
          range and a granularity to see day-by-day, week-by-week, or
          month-by-month totals. Only approved entries count;
          pending and rejected are ignored.
        </p>
      </header>

      {!unlocked ? (
        <form
          onSubmit={handleUnlock}
          style={{
            ...cardShell,
            padding: 26,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 480,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 3,
              background: "linear-gradient(90deg, var(--gold), transparent 78%)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              aria-hidden
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "rgba(232,197,114,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 19,
                flexShrink: 0,
              }}
            >
              🔒
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                Enter summary passphrase
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Same passphrase as the Royalty Approval queue. Read-only
                view; doesn&apos;t change any entries.
              </div>
            </div>
          </div>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            autoFocus
            inputMode="numeric"
            style={{
              padding: "11px 14px",
              fontSize: 16,
              fontFamily: "ui-monospace, monospace",
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              letterSpacing: "0.2em",
            }}
          />
          {errorBanner}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Link
              href="/accounts"
              style={{ fontSize: 12, color: "var(--muted)" }}
            >
              ← Back to Accounts
            </Link>
            <button
              type="submit"
              disabled={pending || !passphrase}
              className="primary-button"
              style={{
                padding: "9px 18px",
                fontWeight: 700,
                fontSize: 14,
                opacity: !passphrase ? 0.6 : 1,
              }}
            >
              {pending ? "Unlocking…" : "Unlock"}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {errorBanner}

          {/* Filter strip */}
          <div
            style={{
              ...cardShell,
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              padding: "14px 18px",
              alignItems: "flex-end",
            }}
          >
            {granularity === "day" ? (
              <label
                style={{ display: "flex", flexDirection: "column", gap: 5 }}
              >
                <span style={{ ...eyebrowStyle, fontSize: 10 }}>Date</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setToDate(e.target.value);
                  }}
                  min="2015-01-01"
                  max={`${new Date().getFullYear() + 1}-12-31`}
                  style={{
                    padding: "8px 11px",
                    fontSize: 13,
                    border: "1px solid var(--border)",
                    borderRadius: 9,
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                />
              </label>
            ) : (
              <>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 5 }}
                >
                  <span style={{ ...eyebrowStyle, fontSize: 10 }}>From</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    min="2015-01-01"
                    max={`${new Date().getFullYear() + 1}-12-31`}
                    style={{
                      padding: "8px 11px",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                    }}
                  />
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 5 }}
                >
                  <span style={{ ...eyebrowStyle, fontSize: 10 }}>To</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min="2015-01-01"
                    max={`${new Date().getFullYear() + 1}-12-31`}
                    style={{
                      padding: "8px 11px",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                    }}
                  />
                </label>
              </>
            )}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 5 }}
            >
              <span style={{ ...eyebrowStyle, fontSize: 10 }}>Group by</span>
              <div
                role="tablist"
                style={{
                  display: "inline-flex",
                  background: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 4,
                  gap: 3,
                }}
              >
                {(["day", "week", "month"] as const).map((g) => (
                  <GranButton
                    key={g}
                    active={granularity === g}
                    label={
                      g === "day" ? "Day" : g === "week" ? "Week" : "Month"
                    }
                    onClick={() => setGranularity(g)}
                  />
                ))}
              </div>
            </div>
            <div
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              {result &&
                `${result.totals.entryCount} approved entr${
                  result.totals.entryCount === 1 ? "y" : "ies"
                } · ${result.buckets.length} bucket${
                  result.buckets.length === 1 ? "" : "s"
                }`}
            </div>
          </div>

          {/* Period totals */}
          {result && (
            <div>
              <div style={{ ...eyebrowStyle, fontSize: 10, marginBottom: 8 }}>
                Period totals
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 12,
                }}
              >
                <StatTile
                  label="Received from vendors"
                  value={`+${fmtPoints(result.totals.received)}`}
                  tone={{ main: "#10b981", glow: "rgba(16,185,129,0.15)" }}
                  fg="var(--rsx-green)"
                />
                <StatTile
                  label="Given to vendors"
                  value={`−${fmtPoints(result.totals.given)}`}
                  tone={{ main: "#f59e0b", glow: "rgba(245,158,11,0.15)" }}
                  fg="var(--rsx-amber)"
                />
                <StatTile
                  label="Net (given − received)"
                  value={`${netTone.icon} ${fmtPoints(Math.abs(result.totals.net))}`}
                  caption={netTone.caption}
                  tone={netTone.tile}
                  fg={netTone.fg}
                />
              </div>
            </div>
          )}

          {/* Bucket table */}
          {result &&
            (result.buckets.length === 0 ? (
              <div
                style={{
                  padding: 36,
                  textAlign: "center",
                  background: "var(--surface)",
                  border: "1px dashed var(--border)",
                  borderRadius: 16,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                No approved royalty entries in this range.
              </div>
            ) : (
              <div style={cardShell}>
                <PanelHeader>
                  {granularity === "day"
                    ? "Day by day"
                    : granularity === "week"
                      ? "Week by week"
                      : "Month by month"}
                </PanelHeader>
                <table
                  style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={th()}>
                        {granularity === "day"
                          ? "Day"
                          : granularity === "week"
                            ? "Week"
                            : "Month"}
                      </th>
                      <th style={{ ...th(), textAlign: "right" }}>Received</th>
                      <th style={{ ...th(), textAlign: "right" }}>Given</th>
                      <th style={{ ...th(), textAlign: "right" }}>Net</th>
                      <th style={{ ...th(), textAlign: "right" }}>Entries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.buckets.map((b) => {
                      const netSign =
                        b.net > 0.5 ? "+" : b.net < -0.5 ? "−" : "";
                      const netColor =
                        b.net > 0.5
                          ? "var(--rsx-amber)"
                          : b.net < -0.5
                            ? "var(--rsx-green)"
                            : "var(--muted)";
                      const isExpanded = expandedBucketKey === b.key;
                      const isSingleBucket = result.buckets.length === 1;
                      // Auto-expand when only one bucket (typical for
                      // Day mode, single date) so dad sees vendors
                      // without clicking.
                      const showVendors = isExpanded || isSingleBucket;
                      return (
                        <Fragment key={b.key}>
                          <tr
                            className={isSingleBucket ? undefined : "rsx-click"}
                            onClick={() =>
                              setExpandedBucketKey(
                                isExpanded ? null : b.key,
                              )
                            }
                            style={{
                              borderBottom: "1px solid var(--border)",
                              background: isExpanded
                                ? "rgba(232,197,114,0.16)"
                                : undefined,
                            }}
                          >
                            <td style={{ ...td(), fontWeight: 700 }}>
                              {!isSingleBucket && (
                                <span
                                  aria-hidden
                                  style={{
                                    display: "inline-block",
                                    width: 12,
                                    color: "var(--muted)",
                                    fontSize: 10,
                                    marginRight: 6,
                                  }}
                                >
                                  {isExpanded ? "▾" : "▸"}
                                </span>
                              )}
                              {b.label}
                              {granularity !== "day" && (
                                <div
                                  style={{
                                    marginLeft: isSingleBucket ? 0 : 18,
                                    marginTop: 2,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "var(--muted)",
                                  }}
                                >
                                  {fmtDateRange(b.rangeStart, b.rangeEnd)}
                                </div>
                              )}
                            </td>
                            <td
                              style={{
                                ...td(),
                                textAlign: "right",
                                fontFamily: "ui-monospace, monospace",
                                color:
                                  b.received > 0
                                    ? "var(--rsx-green)"
                                    : "var(--muted-light)",
                                fontWeight: b.received > 0 ? 700 : 500,
                              }}
                            >
                              {b.received > 0
                                ? `+${fmtPoints(b.received)}`
                                : "—"}
                            </td>
                            <td
                              style={{
                                ...td(),
                                textAlign: "right",
                                fontFamily: "ui-monospace, monospace",
                                color:
                                  b.given > 0
                                    ? "var(--rsx-amber)"
                                    : "var(--muted-light)",
                                fontWeight: b.given > 0 ? 700 : 500,
                              }}
                            >
                              {b.given > 0
                                ? `−${fmtPoints(b.given)}`
                                : "—"}
                            </td>
                            <td
                              style={{
                                ...td(),
                                textAlign: "right",
                                fontFamily: "ui-monospace, monospace",
                                fontWeight: 800,
                                color: netColor,
                              }}
                            >
                              {netSign}
                              {fmtPoints(Math.abs(b.net))}
                            </td>
                            <td
                              style={{
                                ...td(),
                                textAlign: "right",
                                color: "var(--muted)",
                                fontSize: 12,
                              }}
                            >
                              {b.entryCount}
                            </td>
                          </tr>
                          {/* Vendor breakdown — rendered as real rows in THIS
                              table so every column lines up under the bucket
                              row above (a nested table drifted out of line). */}
                          {showVendors &&
                            b.vendors.map((v) => {
                              const vSign =
                                v.net > 0.5 ? "+" : v.net < -0.5 ? "−" : "";
                              const vColor =
                                v.net > 0.5
                                  ? "var(--rsx-amber)"
                                  : v.net < -0.5
                                    ? "var(--rsx-green)"
                                    : "var(--muted)";
                              return (
                                <tr
                                  key={`${b.key}:${v.id}`}
                                  style={{
                                    background: isExpanded
                                      ? "rgba(232,197,114,0.08)"
                                      : "var(--surface-alt)",
                                    borderBottom: "1px solid var(--border)",
                                  }}
                                >
                                  <td
                                    style={{
                                      ...td(),
                                      padding: "6px 14px 6px 34px",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: "var(--muted)",
                                    }}
                                  >
                                    · {v.name}
                                  </td>
                                  <td
                                    style={{
                                      ...td(),
                                      padding: "6px 14px",
                                      textAlign: "right",
                                      fontSize: 12,
                                      fontFamily: "ui-monospace, monospace",
                                      color:
                                        v.received > 0
                                          ? "var(--rsx-green)"
                                          : "var(--muted-light)",
                                      fontWeight: v.received > 0 ? 700 : 500,
                                    }}
                                  >
                                    {v.received > 0
                                      ? `+${fmtPoints(v.received)}`
                                      : "—"}
                                  </td>
                                  <td
                                    style={{
                                      ...td(),
                                      padding: "6px 14px",
                                      textAlign: "right",
                                      fontSize: 12,
                                      fontFamily: "ui-monospace, monospace",
                                      color:
                                        v.given > 0
                                          ? "var(--rsx-amber)"
                                          : "var(--muted-light)",
                                      fontWeight: v.given > 0 ? 700 : 500,
                                    }}
                                  >
                                    {v.given > 0
                                      ? `−${fmtPoints(v.given)}`
                                      : "—"}
                                  </td>
                                  <td
                                    style={{
                                      ...td(),
                                      padding: "6px 14px",
                                      textAlign: "right",
                                      fontSize: 12,
                                      fontFamily: "ui-monospace, monospace",
                                      fontWeight: 800,
                                      color: vColor,
                                    }}
                                  >
                                    {vSign}
                                    {fmtPoints(Math.abs(v.net))}
                                  </td>
                                  <td
                                    style={{
                                      ...td(),
                                      padding: "6px 14px",
                                      textAlign: "right",
                                      fontSize: 11,
                                      color: "var(--muted)",
                                    }}
                                  >
                                    {v.entryCount}
                                  </td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr
                      style={{
                        background: "rgba(232,197,114,0.16)",
                        borderTop: "2px solid var(--gold)",
                      }}
                    >
                      <td style={{ ...td(), fontWeight: 800 }}>Total</td>
                      <td
                        style={{
                          ...td(),
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 800,
                          color: "var(--rsx-green)",
                        }}
                      >
                        {result.totals.received > 0
                          ? `+${fmtPoints(result.totals.received)}`
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...td(),
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 800,
                          color: "var(--rsx-amber)",
                        }}
                      >
                        {result.totals.given > 0
                          ? `−${fmtPoints(result.totals.given)}`
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...td(),
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 800,
                          color: netTone.fg,
                        }}
                      >
                        {result.totals.net > 0.5
                          ? "+"
                          : result.totals.net < -0.5
                            ? "−"
                            : ""}
                        {fmtPoints(Math.abs(result.totals.net))}
                      </td>
                      <td
                        style={{
                          ...td(),
                          textAlign: "right",
                          fontWeight: 800,
                        }}
                      >
                        {result.totals.entryCount}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}

          {/* Per-vendor totals across the WHOLE selected range —
              the answer to "show me which vendor". Each row carries
              the dates its entries fall on, and clicking expands to
              the individual entries (date · direction · amount). */}
          {result && result.vendors.length > 0 && (
            <div style={cardShell}>
              <PanelHeader>
                Per vendor · {result.vendors.length} vendor
                {result.vendors.length === 1 ? "" : "s"} active in this range
                <span style={{ marginLeft: "auto", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                  Click a vendor for its entries
                </span>
              </PanelHeader>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={th()}>Vendor</th>
                    <th style={{ ...th(), textAlign: "right" }}>Received</th>
                    <th style={{ ...th(), textAlign: "right" }}>Given</th>
                    <th style={{ ...th(), textAlign: "right" }}>Net</th>
                    <th style={{ ...th(), textAlign: "right" }}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {result.vendors.map((v) => {
                    const netSign =
                      v.net > 0.5 ? "+" : v.net < -0.5 ? "−" : "";
                    const netColor =
                      v.net > 0.5
                        ? "var(--rsx-amber)"
                        : v.net < -0.5
                          ? "var(--rsx-green)"
                          : "var(--muted)";
                    const entries = v.entries ?? [];
                    const isOpen = expandedVendorId === v.id;
                    const dateLine =
                      entries.length > 0
                        ? fmtDateRange(
                            entries[0].date,
                            entries[entries.length - 1].date,
                          )
                        : null;
                    return (
                      <Fragment key={v.id}>
                        <tr
                          className="rsx-click"
                          onClick={() =>
                            setExpandedVendorId(isOpen ? null : v.id)
                          }
                          style={{
                            borderBottom: "1px solid var(--border)",
                            background: isOpen
                              ? "rgba(232,197,114,0.16)"
                              : undefined,
                          }}
                        >
                          <td style={{ ...td(), fontWeight: 700 }}>
                            <span
                              aria-hidden
                              style={{
                                display: "inline-block",
                                width: 12,
                                color: "var(--muted)",
                                fontSize: 10,
                                marginRight: 6,
                              }}
                            >
                              {isOpen ? "▾" : "▸"}
                            </span>
                            {v.name}
                            {dateLine && (
                              <div
                                style={{
                                  marginLeft: 18,
                                  marginTop: 2,
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: "var(--muted)",
                                }}
                              >
                                {dateLine}
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              ...td(),
                              textAlign: "right",
                              fontFamily: "ui-monospace, monospace",
                              color:
                                v.received > 0
                                  ? "var(--rsx-green)"
                                  : "var(--muted-light)",
                              fontWeight: v.received > 0 ? 700 : 500,
                            }}
                          >
                            {v.received > 0
                              ? `+${fmtPoints(v.received)}`
                              : "—"}
                          </td>
                          <td
                            style={{
                              ...td(),
                              textAlign: "right",
                              fontFamily: "ui-monospace, monospace",
                              color:
                                v.given > 0
                                  ? "var(--rsx-amber)"
                                  : "var(--muted-light)",
                              fontWeight: v.given > 0 ? 700 : 500,
                            }}
                          >
                            {v.given > 0 ? `−${fmtPoints(v.given)}` : "—"}
                          </td>
                          <td
                            style={{
                              ...td(),
                              textAlign: "right",
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 800,
                              color: netColor,
                            }}
                          >
                            {netSign}
                            {fmtPoints(Math.abs(v.net))}
                          </td>
                          <td
                            style={{
                              ...td(),
                              textAlign: "right",
                              color: "var(--muted)",
                              fontSize: 12,
                            }}
                          >
                            {v.entryCount}
                          </td>
                        </tr>
                        {/* The vendor's individual entries — one row per
                            entry, date in the first column, the amount in
                            its direction's column. */}
                        {isOpen &&
                          entries.map((en, i) => (
                            <tr
                              key={`${v.id}:${en.date}:${i}`}
                              style={{
                                background: "rgba(232,197,114,0.08)",
                                borderBottom: "1px solid var(--border)",
                              }}
                            >
                              <td
                                style={{
                                  ...td(),
                                  padding: "6px 14px 6px 34px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "var(--muted)",
                                }}
                              >
                                · {fmtDate(en.date)}
                              </td>
                              <td
                                style={{
                                  ...td(),
                                  padding: "6px 14px",
                                  textAlign: "right",
                                  fontSize: 12,
                                  fontFamily: "ui-monospace, monospace",
                                  color:
                                    en.type === "received"
                                      ? "var(--rsx-green)"
                                      : "var(--muted-light)",
                                  fontWeight: en.type === "received" ? 700 : 500,
                                }}
                              >
                                {en.type === "received"
                                  ? `+${fmtPoints(en.amount)}`
                                  : "—"}
                              </td>
                              <td
                                style={{
                                  ...td(),
                                  padding: "6px 14px",
                                  textAlign: "right",
                                  fontSize: 12,
                                  fontFamily: "ui-monospace, monospace",
                                  color:
                                    en.type === "given"
                                      ? "var(--rsx-amber)"
                                      : "var(--muted-light)",
                                  fontWeight: en.type === "given" ? 700 : 500,
                                }}
                              >
                                {en.type === "given"
                                  ? `−${fmtPoints(en.amount)}`
                                  : "—"}
                              </td>
                              <td
                                style={{
                                  ...td(),
                                  padding: "6px 14px",
                                  textAlign: "right",
                                  fontSize: 12,
                                  fontFamily: "ui-monospace, monospace",
                                  fontWeight: 700,
                                  color:
                                    en.type === "given"
                                      ? "var(--rsx-amber)"
                                      : "var(--rsx-green)",
                                }}
                              >
                                {en.type === "given" ? "+" : "−"}
                                {fmtPoints(en.amount)}
                              </td>
                              <td style={{ ...td(), padding: "6px 14px" }} />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Link
              href="/accounts"
              style={{ fontSize: 12, color: "var(--muted)" }}
            >
              ← Back to Accounts
            </Link>
            <button
              type="button"
              onClick={fetchSummary}
              disabled={pending}
              className="ghost-button"
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              {pending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function GranButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "6px 16px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? "var(--gold)" : "transparent",
        color: active ? "#fff" : "var(--muted)",
        border: "none",
        borderRadius: 9,
        cursor: active ? "default" : "pointer",
        boxShadow: active ? "0 2px 6px rgba(0,0,0,0.18)" : "none",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function th(): React.CSSProperties {
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
function td(): React.CSSProperties {
  return {
    padding: "11px 14px",
    fontSize: 13,
    color: "var(--text)",
  };
}
