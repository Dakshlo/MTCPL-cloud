"use client";

/**
 * Cross-vendor royalty summary — passphrase-gated.
 *
 * Three-stage UX:
 *   1. Locked: enter passphrase (same 125500 as Royalty Approval).
 *   2. Unlocked: pick date range + granularity (Day / Week / Month).
 *      Auto-loads with sensible defaults (current month, daily).
 *   3. Results: totals tile + bucket table. Each row shows
 *      received / given / net for that bucket.
 *
 * "Royalty points" not rupees — same convention as the rest of
 * the royalty surfaces (see fmtPoints in royalty-approvals-client).
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

type VendorBreakdown = {
  id: string;
  name: string;
  received: number;
  given: number;
  net: number;
  entryCount: number;
};

type SummaryResult =
  | {
      ok: true;
      buckets: Array<{
        key: string;
        label: string;
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

  // Net tint — same convention as the rest of the royalty UI.
  const netTone = useMemo(() => {
    const n = result?.totals.net ?? 0;
    if (n > 0.5)
      return {
        bg: "#fef3c7",
        border: "#d97706",
        fg: "#b45309",
        icon: "↗",
        caption: "We paid net to vendors",
      };
    if (n < -0.5)
      return {
        bg: "#dcfce7",
        border: "#16a34a",
        fg: "#15803d",
        icon: "↘",
        caption: "Vendors paid net to us",
      };
    return {
      bg: "#f1f5f9",
      border: "#cbd5e1",
      fg: "#475569",
      icon: "·",
      caption: "Even — no net direction",
    };
  }, [result]);

  return (
    <section className="page-card" style={{ maxWidth: 980 }}>
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
        <h1 style={{ margin: "2px 0", fontSize: 24, fontWeight: 800 }}>
          🏷️ Royalty Summary
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
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
            background: "#fffbeb",
            border: "1px dashed #d97706",
            borderRadius: 12,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 480,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#92400e",
                marginBottom: 4,
              }}
            >
              🔒 Enter summary passphrase
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Same passphrase as the Royalty Approval queue. Read-only
              view; doesn&apos;t change any entries.
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
              padding: "10px 14px",
              fontSize: 16,
              fontFamily: "ui-monospace, monospace",
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              letterSpacing: "0.2em",
            }}
          />
          {error && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                background: "#fee2e2",
                border: "1px solid #b91c1c",
                color: "#b91c1c",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
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
          {error && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                background: "#fee2e2",
                border: "1px solid #b91c1c",
                color: "#b91c1c",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {/* Filter strip */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              padding: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              alignItems: "flex-end",
            }}
          >
            {granularity === "day" ? (
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Date
                </span>
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
                    padding: "7px 10px",
                    fontSize: 13,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "#fff",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                />
              </label>
            ) : (
              <>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    From
                  </span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    min="2015-01-01"
                    max={`${new Date().getFullYear() + 1}-12-31`}
                    style={{
                      padding: "7px 10px",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "#fff",
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                    }}
                  />
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    To
                  </span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min="2015-01-01"
                    max={`${new Date().getFullYear() + 1}-12-31`}
                    style={{
                      padding: "7px 10px",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "#fff",
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                    }}
                  />
                </label>
              </>
            )}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Group by
              </span>
              <div
                role="tablist"
                style={{
                  display: "inline-flex",
                  background: "#f1f5f9",
                  borderRadius: 999,
                  padding: 3,
                  gap: 2,
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

          {/* Totals tile */}
          {result && (
            <div
              style={{
                padding: 14,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 10,
                }}
              >
                Period totals
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 10,
                }}
              >
                <TotalTile
                  label="Received from vendors"
                  value={fmtPoints(result.totals.received)}
                  prefix="+"
                  tone={{ bg: "#dcfce7", border: "#16a34a", fg: "#15803d" }}
                />
                <TotalTile
                  label="Given to vendors"
                  value={fmtPoints(result.totals.given)}
                  prefix="−"
                  tone={{ bg: "#fef3c7", border: "#d97706", fg: "#b45309" }}
                />
                <div
                  style={{
                    padding: "12px 14px",
                    background: netTone.bg,
                    border: `1.5px solid ${netTone.border}`,
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: netTone.fg,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Net (given − received)
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: netTone.fg,
                      marginTop: 3,
                      fontFamily: "ui-monospace, monospace",
                      fontFeatureSettings: '"tnum"',
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {netTone.icon}{" "}
                    {fmtPoints(Math.abs(result.totals.net))}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: netTone.fg,
                      marginTop: 2,
                      fontWeight: 600,
                    }}
                  >
                    {netTone.caption}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bucket table */}
          {result &&
            (result.buckets.length === 0 ? (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  background: "var(--surface)",
                  border: "1px dashed var(--border)",
                  borderRadius: 12,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                No approved royalty entries in this range.
              </div>
            ) : (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <table
                  style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "#f8fafc",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
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
                          ? "#b45309"
                          : b.net < -0.5
                            ? "#15803d"
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
                            onClick={() =>
                              setExpandedBucketKey(
                                isExpanded ? null : b.key,
                              )
                            }
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              cursor: isSingleBucket ? "default" : "pointer",
                              background: isExpanded ? "#fffbeb" : undefined,
                            }}
                          >
                            <td style={{ ...td(), fontWeight: 600 }}>
                              {!isSingleBucket && (
                                <span
                                  aria-hidden
                                  style={{
                                    display: "inline-block",
                                    width: 12,
                                    color: "#94a3b8",
                                    fontSize: 10,
                                    marginRight: 6,
                                  }}
                                >
                                  {isExpanded ? "▾" : "▸"}
                                </span>
                              )}
                              {b.label}
                            </td>
                            <td
                              style={{
                                ...td(),
                                textAlign: "right",
                                fontFamily: "ui-monospace, monospace",
                                color:
                                  b.received > 0
                                    ? "#15803d"
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
                                    ? "#b45309"
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
                          {showVendors && b.vendors.length > 0 && (
                            <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td colSpan={5} style={{ padding: 0 }}>
                                <VendorBreakdownRows
                                  vendors={b.vendors}
                                  parentTone={isExpanded ? "#fffbeb" : "#fafafa"}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr
                      style={{
                        background: "#fffbeb",
                        borderTop: "2px solid #d97706",
                      }}
                    >
                      <td style={{ ...td(), fontWeight: 800 }}>Total</td>
                      <td
                        style={{
                          ...td(),
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 800,
                          color: "#15803d",
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
                          color: "#b45309",
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
              the answer to "show me which vendor". Always visible
              when there's data; lets dad scan vendor-by-vendor net
              without expanding each bucket. */}
          {result && result.vendors.length > 0 && (
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  background: "#f8fafc",
                  borderBottom: "1px solid #e2e8f0",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Per vendor · {result.vendors.length} vendor
                {result.vendors.length === 1 ? "" : "s"} active in this range
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
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
                        ? "#b45309"
                        : v.net < -0.5
                          ? "#15803d"
                          : "var(--muted)";
                    return (
                      <tr
                        key={v.id}
                        style={{ borderBottom: "1px solid #f1f5f9" }}
                      >
                        <td style={{ ...td(), fontWeight: 600 }}>{v.name}</td>
                        <td
                          style={{
                            ...td(),
                            textAlign: "right",
                            fontFamily: "ui-monospace, monospace",
                            color:
                              v.received > 0
                                ? "#15803d"
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
                              v.given > 0 ? "#b45309" : "var(--muted-light)",
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
        padding: "5px 14px",
        fontSize: 12,
        fontWeight: 700,
        background: active ? "#fff" : "transparent",
        color: active ? "#0f172a" : "#64748b",
        border: "none",
        borderRadius: 999,
        cursor: active ? "default" : "pointer",
        boxShadow: active ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function TotalTile({
  label,
  value,
  prefix,
  tone,
}: {
  label: string;
  value: string;
  prefix?: string;
  tone: { bg: string; border: string; fg: string };
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: tone.fg,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: tone.fg,
          marginTop: 3,
          fontFamily: "ui-monospace, monospace",
          fontFeatureSettings: '"tnum"',
          letterSpacing: "-0.01em",
        }}
      >
        {prefix ?? ""}
        {value}
      </div>
    </div>
  );
}

/** Renders the per-vendor breakdown inside an expanded bucket row.
 *  Lives in a single colSpan=5 cell so we don't fight the parent
 *  table's column widths. Indented + slightly muted so it reads as
 *  a sub-list, not a peer of the main row. */
function VendorBreakdownRows({
  vendors,
  parentTone,
}: {
  vendors: VendorBreakdown[];
  parentTone: string;
}) {
  return (
    <div style={{ background: parentTone, padding: "6px 14px 10px 32px" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <tbody>
          {vendors.map((v) => {
            const netSign = v.net > 0.5 ? "+" : v.net < -0.5 ? "−" : "";
            const netColor =
              v.net > 0.5
                ? "#b45309"
                : v.net < -0.5
                  ? "#15803d"
                  : "var(--muted)";
            return (
              <tr key={v.id}>
                <td
                  style={{
                    padding: "4px 8px 4px 0",
                    color: "#475569",
                    fontWeight: 600,
                  }}
                >
                  · {v.name}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    color: v.received > 0 ? "#15803d" : "var(--muted-light)",
                    fontWeight: v.received > 0 ? 700 : 500,
                    minWidth: 90,
                  }}
                >
                  {v.received > 0 ? `+${fmtPoints(v.received)}` : "—"}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    color: v.given > 0 ? "#b45309" : "var(--muted-light)",
                    fontWeight: v.given > 0 ? 700 : 500,
                    minWidth: 90,
                  }}
                >
                  {v.given > 0 ? `−${fmtPoints(v.given)}` : "—"}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 800,
                    color: netColor,
                    minWidth: 90,
                  }}
                >
                  {netSign}
                  {fmtPoints(Math.abs(v.net))}
                </td>
                <td
                  style={{
                    padding: "4px 0 4px 8px",
                    textAlign: "right",
                    color: "var(--muted)",
                    fontSize: 11,
                    minWidth: 40,
                  }}
                >
                  {v.entryCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--text)",
  };
}
