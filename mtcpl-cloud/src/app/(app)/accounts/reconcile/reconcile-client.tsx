"use client";

/**
 * Mig 082 follow-on (Daksh, June 2026) — Reconcile UI for the
 * starred accountant. Tally-style two-pane spreadsheet:
 *
 *   ┌─ Vendors ──────────────────┬─ Bills for [vendor] ──────────┐
 *   │ AARAV STONE      ₹17.4L    │ T-2026-117  ₹4,37,484         │
 *   │ HIMALAYA MARBLE  ₹11.9L  → │ T-2026-118  ₹4,01,057         │
 *   │ ...                        │ ...                            │
 *   └────────────────────────────┴────────────────────────────────┘
 *
 * Keyboard map:
 *   ↑ / ↓        — move the focused row inside the active pane
 *   Enter or →   — jump from vendor list into bills pane for that
 *                  vendor
 *   ← or Esc     — back to vendor list (or clear search)
 *   /            — focus the search input
 *
 * Pure presentation — every state lives in React, every action is
 * a setState. Zero server actions imported here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ACCOUNTS_TOKENS, Money } from "../_ui/components";

export type ReconcileBillRow = {
  id: string;
  token: string;
  vendorBillNo: string;
  billDate: string;
  description: string;
  costHead: string | null;
  amountTotal: number;
  amountPaid: number;
  amountOutstanding: number;
  heldAmount: number;
  vendorId: string;
  vendorName: string;
  vendorNickname: string | null;
  vendorCategory: string | null;
};

type VendorAgg = {
  id: string;
  name: string;
  nickname: string | null;
  category: string | null;
  totalOutstanding: number;
  totalHeld: number;
  billCount: number;
  bills: ReconcileBillRow[];
};

type Pane = "vendors" | "bills";

// Mig 082 follow-on (Daksh round 2) — date filter type. Bill-date
// scoped; "All" = no filter. The filter cascades downward — bills
// outside the window are dropped, so vendor aggregates + grand
// total recompute against the filtered set automatically.
type DateRange = "today" | "yesterday" | "last_7d" | "last_30d" | "all";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
function startOfDayIstMs(d: Date): number {
  const ist = d.getTime() + IST_OFFSET_MS;
  return Math.floor(ist / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

export function ReconcileClient({ bills }: { bills: ReconcileBillRow[] }) {
  // ── Date filter state — cascades into vendor list + grand total ─
  const [dateRange, setDateRange] = useState<DateRange>("all");

  const filteredBills = useMemo(() => {
    if (dateRange === "all") return bills;
    const todayStart = startOfDayIstMs(new Date());
    const yesterdayStart = todayStart - DAY_MS;
    const sevenAgoStart = todayStart - 7 * DAY_MS;
    const thirtyAgoStart = todayStart - 30 * DAY_MS;
    return bills.filter((b) => {
      const t = new Date(b.billDate).getTime();
      if (dateRange === "today") return t >= todayStart;
      if (dateRange === "yesterday")
        return t >= yesterdayStart && t < todayStart;
      if (dateRange === "last_7d") return t >= sevenAgoStart;
      // last_30d
      return t >= thirtyAgoStart;
    });
  }, [bills, dateRange]);

  // ── Aggregate by vendor (memoised) ────────────────────────────────
  // Reads from filteredBills, so when the date range changes the
  // vendor list, grand total, bill counts — every downstream value —
  // recompute against just the bills in the window.
  const vendorList: VendorAgg[] = useMemo(() => {
    const m = new Map<string, VendorAgg>();
    for (const b of filteredBills) {
      const cur = m.get(b.vendorId) ?? {
        id: b.vendorId,
        name: b.vendorName,
        nickname: b.vendorNickname,
        category: b.vendorCategory,
        totalOutstanding: 0,
        totalHeld: 0,
        billCount: 0,
        bills: [],
      };
      cur.totalOutstanding += b.amountOutstanding;
      cur.totalHeld += b.heldAmount;
      cur.billCount += 1;
      cur.bills.push(b);
      m.set(b.vendorId, cur);
    }
    // Sort: largest outstanding first, then name asc as tiebreak.
    return [...m.values()].sort((a, b) => {
      if (b.totalOutstanding !== a.totalOutstanding) {
        return b.totalOutstanding - a.totalOutstanding;
      }
      return a.name.localeCompare(b.name);
    });
  }, [filteredBills]);

  const grandTotal = useMemo(
    () => vendorList.reduce((s, v) => s + v.totalOutstanding, 0),
    [vendorList],
  );

  // ── Blur grand total (sensitive number) ──────────────────────────
  // Daksh: "blur it and give button to unblur it for 10 sec".
  // Defaults to blurred on every page load. Pressing the reveal
  // button starts a 10-second timer; expires automatically.
  const [grandTotalRevealed, setGrandTotalRevealed] = useState(false);
  useEffect(() => {
    if (!grandTotalRevealed) return;
    const t = setTimeout(() => setGrandTotalRevealed(false), 10000);
    return () => clearTimeout(t);
  }, [grandTotalRevealed]);

  // ── Full-screen toggle ────────────────────────────────────────────
  // CSS-only — we apply position:fixed on the outer wrapper so it
  // covers the sidebar + topbar. Esc exits. No fullscreen API
  // because we want the in-app chrome controls (Exit button)
  // visible, not the browser's escape banner.
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && document.activeElement?.tagName !== "INPUT") {
        setFullScreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  // ── Search + filtered list ────────────────────────────────────────
  const [query, setQuery] = useState("");
  const filteredVendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendorList;
    return vendorList.filter((v) => {
      if (v.name.toLowerCase().includes(q)) return true;
      if (v.nickname && v.nickname.toLowerCase().includes(q)) return true;
      if (v.category && v.category.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [vendorList, query]);

  // ── Selection + keyboard nav state ────────────────────────────────
  const [vendorIdx, setVendorIdx] = useState(0);
  const [billIdx, setBillIdx] = useState(0);
  const [activePane, setActivePane] = useState<Pane>("vendors");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const vendorScrollRef = useRef<HTMLDivElement | null>(null);
  const billScrollRef = useRef<HTMLDivElement | null>(null);
  const focusedVendorRowRef = useRef<HTMLTableRowElement | null>(null);
  const focusedBillRowRef = useRef<HTMLTableRowElement | null>(null);

  // Clamp the focused indices whenever the list shrinks.
  useEffect(() => {
    if (vendorIdx >= filteredVendors.length) {
      setVendorIdx(Math.max(0, filteredVendors.length - 1));
    }
  }, [filteredVendors.length, vendorIdx]);

  const focusedVendor: VendorAgg | null =
    filteredVendors[vendorIdx] ?? null;

  useEffect(() => {
    if (!focusedVendor) {
      setBillIdx(0);
      return;
    }
    if (billIdx >= focusedVendor.bills.length) {
      setBillIdx(Math.max(0, focusedVendor.bills.length - 1));
    }
  }, [focusedVendor, billIdx]);

  // Auto-scroll the focused row into view in either pane.
  useEffect(() => {
    focusedVendorRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [vendorIdx]);
  useEffect(() => {
    focusedBillRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [billIdx, focusedVendor?.id]);

  // ── Global keyboard handler ───────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip when typing in the search box (it has its own handlers).
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        // Only the Esc-to-blur shortcut applies here.
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }
      // "/" focuses the search box from anywhere on the page.
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (activePane === "vendors") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setVendorIdx((i) =>
            Math.min(filteredVendors.length - 1, i + 1),
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setVendorIdx((i) => Math.max(0, i - 1));
        } else if (
          e.key === "Enter" ||
          e.key === "ArrowRight" ||
          e.key === "Tab"
        ) {
          if (focusedVendor && focusedVendor.bills.length > 0) {
            e.preventDefault();
            setActivePane("bills");
            setBillIdx(0);
          }
        } else if (e.key === "PageDown") {
          e.preventDefault();
          setVendorIdx((i) =>
            Math.min(filteredVendors.length - 1, i + 10),
          );
        } else if (e.key === "PageUp") {
          e.preventDefault();
          setVendorIdx((i) => Math.max(0, i - 10));
        } else if (e.key === "Home") {
          e.preventDefault();
          setVendorIdx(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setVendorIdx(Math.max(0, filteredVendors.length - 1));
        }
      } else if (activePane === "bills") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setBillIdx((i) =>
            Math.min((focusedVendor?.bills.length ?? 1) - 1, i + 1),
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setBillIdx((i) => Math.max(0, i - 1));
        } else if (
          e.key === "ArrowLeft" ||
          e.key === "Escape" ||
          (e.shiftKey && e.key === "Tab")
        ) {
          e.preventDefault();
          setActivePane("vendors");
        } else if (e.key === "PageDown") {
          e.preventDefault();
          setBillIdx((i) =>
            Math.min((focusedVendor?.bills.length ?? 1) - 1, i + 10),
          );
        } else if (e.key === "PageUp") {
          e.preventDefault();
          setBillIdx((i) => Math.max(0, i - 10));
        } else if (e.key === "Home") {
          e.preventDefault();
          setBillIdx(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setBillIdx(Math.max(0, (focusedVendor?.bills.length ?? 1) - 1));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePane, filteredVendors.length, focusedVendor]);

  // Click-to-focus handlers — mouse users can still drive everything.
  const focusVendorAt = (idx: number) => {
    setVendorIdx(idx);
    setActivePane("vendors");
    setBillIdx(0);
  };
  const focusBillAt = (idx: number) => {
    setBillIdx(idx);
    setActivePane("bills");
  };

  // Mig 082 follow-on (Daksh round 2) — counts derive from the
  // FILTERED set so when the date range narrows, the tiles + the
  // grand total move together. Used to be `bills.length` which
  // ignored the filter.
  const totalBills = filteredBills.length;
  const totalVendors = vendorList.length;
  const heldGrand = vendorList.reduce((s, v) => s + v.totalHeld, 0);

  // Outer wrapper — when full-screen, fix-position over the whole
  // viewport so the sidebar + topbar disappear. Otherwise it's
  // an in-flow flex column like before.
  const outerStyle: React.CSSProperties = fullScreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg, #faf7ef)",
        padding: "16px 18px",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }
    : { display: "flex", flexDirection: "column", gap: 14 };

  return (
    <div style={outerStyle}>
      {/* ── Date filter + full-screen + page controls ─────────────
          Mig 082 follow-on (Daksh round 2). Date filter cascades
          into every count + total below; the full-screen toggle
          covers the sidebar so the spreadsheet uses the whole
          viewport (cleaner for desktop-with-tally workflows). */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "10px 12px",
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginRight: 6,
          }}
        >
          Bill date
        </div>
        {(
          [
            { v: "today", label: "Today" },
            { v: "yesterday", label: "Yesterday" },
            { v: "last_7d", label: "Last 7 days" },
            { v: "last_30d", label: "Last 30 days" },
            { v: "all", label: "All" },
          ] as Array<{ v: DateRange; label: string }>
        ).map((opt) => {
          const active = opt.v === dateRange;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => {
                setDateRange(opt.v);
                setVendorIdx(0);
                setBillIdx(0);
                setActivePane("vendors");
              }}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 700,
                background: active ? ACCOUNTS_TOKENS.accent : "#fff",
                color: active ? "#fff" : "var(--text)",
                border: `1px solid ${active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.border}`,
                borderRadius: 999,
                cursor: "pointer",
                letterSpacing: "0.02em",
                fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setFullScreen((f) => !f)}
          title={
            fullScreen
              ? "Exit full screen (also: Esc)"
              : "Hide sidebar — use the full viewport"
          }
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 700,
            background: fullScreen ? ACCOUNTS_TOKENS.accent : "#fff",
            color: fullScreen ? "#fff" : ACCOUNTS_TOKENS.accent,
            border: `1px solid ${ACCOUNTS_TOKENS.accent}`,
            borderRadius: 999,
            cursor: "pointer",
            letterSpacing: "0.02em",
          }}
        >
          {fullScreen ? "✕ Exit full screen" : "⛶ Full screen"}
        </button>
      </div>

      {/* Summary strip — grand total + counts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {/* Mig 082 follow-on (Daksh round 2) — Total outstanding
            blurred by default. Reveal button unblurs for 10s
            (the useEffect upstream auto-flips it back). Sensitive
            number; the accountant sees it on demand only. */}
        <SummaryTile
          label="Total outstanding"
          value={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  filter: grandTotalRevealed ? "none" : "blur(8px)",
                  transition: "filter 0.2s ease",
                  userSelect: grandTotalRevealed ? "auto" : "none",
                  pointerEvents: grandTotalRevealed ? "auto" : "none",
                }}
              >
                <Money value={grandTotal} size="large" tone="danger" />
              </span>
              <button
                type="button"
                onClick={() => setGrandTotalRevealed((v) => !v)}
                title={
                  grandTotalRevealed
                    ? "Re-hide the number"
                    : "Reveal for 10 seconds"
                }
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  background: grandTotalRevealed ? "#fff" : "#b91c1c",
                  color: grandTotalRevealed ? "#b91c1c" : "#fff",
                  border: "1px solid #b91c1c",
                  borderRadius: 999,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {grandTotalRevealed ? "🔒 Hide" : "👁 Reveal 10s"}
              </button>
            </div>
          }
          tint="#b91c1c"
        />
        <SummaryTile
          label="Bills with balance"
          value={
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 20 }}>
              {totalBills.toLocaleString("en-IN")}
            </span>
          }
          tint="#b45309"
        />
        <SummaryTile
          label="Distinct vendors"
          value={
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 20 }}>
              {totalVendors.toLocaleString("en-IN")}
            </span>
          }
          tint="#1d4ed8"
        />
        {heldGrand > 0 && (
          <SummaryTile
            label="Total held"
            value={<Money value={heldGrand} size="large" tone="warning" />}
            tint="#d97706"
          />
        )}
      </div>

      {/* Toolbar — search + keyboard cheat sheet */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "10px 12px",
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 10,
        }}
      >
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVendorIdx(0);
            setActivePane("vendors");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search vendor / nickname / category — press / from anywhere"
          style={{
            flex: "1 1 320px",
            minWidth: 240,
            padding: "8px 12px",
            fontSize: 13,
            border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 8,
            background: "#fff",
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 6,
            fontSize: 10.5,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
            flexWrap: "wrap",
          }}
        >
          <KeyHint k="↑↓" desc="row" />
          <KeyHint k="Enter/→" desc="open" />
          <KeyHint k="←/Esc" desc="back" />
          <KeyHint k="/" desc="search" />
          <KeyHint k="PgUp/PgDn" desc="±10 rows" />
        </div>
      </div>

      {/* Main two-pane table */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.4fr)",
          gap: 0,
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 10,
          overflow: "hidden",
          minHeight: 480,
        }}
      >
        {/* ── Vendors pane ── */}
        <div
          style={{
            borderRight: `1px solid ${ACCOUNTS_TOKENS.border}`,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background:
              activePane === "vendors" ? "#fff" : "#fafafa",
          }}
        >
          <PaneHeader
            label={`Vendors (${filteredVendors.length})`}
            active={activePane === "vendors"}
            onClick={() => setActivePane("vendors")}
          />
          <div
            ref={vendorScrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              maxHeight: 600,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: ACCOUNTS_TOKENS.surfaceMuted,
                  zIndex: 1,
                }}
              >
                <tr>
                  <th style={th}>#</th>
                  <th style={{ ...th, textAlign: "left" }}>Vendor</th>
                  <th style={{ ...th, textAlign: "right" }}>Bills</th>
                  <th style={{ ...th, textAlign: "right" }}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {filteredVendors.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        padding: "20px 14px",
                        textAlign: "center",
                        color: "var(--muted)",
                        fontFamily: "inherit",
                      }}
                    >
                      No vendors match {query ? `"${query}"` : "the filter"}.
                    </td>
                  </tr>
                )}
                {filteredVendors.map((v, i) => {
                  const focused = i === vendorIdx;
                  const focusedInPane =
                    focused && activePane === "vendors";
                  return (
                    <tr
                      key={v.id}
                      ref={focused ? focusedVendorRowRef : null}
                      onClick={() => focusVendorAt(i)}
                      style={{
                        cursor: "pointer",
                        background: focusedInPane
                          ? "rgba(180, 83, 9, 0.14)"
                          : focused
                            ? "rgba(180, 83, 9, 0.05)"
                            : "transparent",
                        borderLeft: focusedInPane
                          ? "3px solid #b45309"
                          : "3px solid transparent",
                      }}
                    >
                      <td style={{ ...td, color: "var(--muted)", textAlign: "right" }}>
                        {i + 1}
                      </td>
                      <td style={{ ...td, fontFamily: "inherit" }}>
                        <div style={{ fontWeight: 700, color: "var(--text)" }}>
                          {v.name}
                        </div>
                        {(v.nickname || v.category) && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: "var(--muted)",
                              marginTop: 1,
                            }}
                          >
                            {[v.nickname, v.category].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {v.billCount}
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#b91c1c",
                        }}
                      >
                        ₹{Math.round(v.totalOutstanding).toLocaleString("en-IN")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Bills pane ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background:
              activePane === "bills" ? "#fff" : "#fafafa",
          }}
        >
          <PaneHeader
            label={
              focusedVendor
                ? `Bills · ${focusedVendor.name}`
                : "Bills"
            }
            active={activePane === "bills"}
            onClick={() => focusedVendor && setActivePane("bills")}
          />
          <div
            ref={billScrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              maxHeight: 600,
            }}
          >
            {!focusedVendor ? (
              <div
                style={{
                  padding: "30px 18px",
                  color: "var(--muted)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Pick a vendor on the left.
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: ACCOUNTS_TOKENS.surfaceMuted,
                    zIndex: 1,
                  }}
                >
                  <tr>
                    <th style={th}>#</th>
                    <th style={{ ...th, textAlign: "left" }}>Token</th>
                    <th style={{ ...th, textAlign: "left" }}>Bill #</th>
                    <th style={{ ...th, textAlign: "left" }}>Date</th>
                    <th style={{ ...th, textAlign: "right" }}>Total</th>
                    <th style={{ ...th, textAlign: "right" }}>Paid</th>
                    <th style={{ ...th, textAlign: "right" }}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {focusedVendor.bills.map((b, i) => {
                    const focused = i === billIdx;
                    const focusedInPane = focused && activePane === "bills";
                    return (
                      <tr
                        key={b.id}
                        ref={focused ? focusedBillRowRef : null}
                        onClick={() => focusBillAt(i)}
                        style={{
                          cursor: "pointer",
                          background: focusedInPane
                            ? "rgba(180, 83, 9, 0.14)"
                            : focused
                              ? "rgba(180, 83, 9, 0.05)"
                              : "transparent",
                          borderLeft: focusedInPane
                            ? "3px solid #b45309"
                            : "3px solid transparent",
                        }}
                      >
                        <td style={{ ...td, color: "var(--muted)", textAlign: "right" }}>
                          {i + 1}
                        </td>
                        <td
                          style={{
                            ...td,
                            color: ACCOUNTS_TOKENS.accent,
                            fontWeight: 700,
                          }}
                        >
                          {b.token}
                        </td>
                        <td style={td}>{b.vendorBillNo}</td>
                        <td style={{ ...td, color: "var(--muted)" }}>
                          {formatDateShort(b.billDate)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          ₹{Math.round(b.amountTotal).toLocaleString("en-IN")}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            color: b.amountPaid > 0 ? "#15803d" : "var(--muted)",
                          }}
                        >
                          {b.amountPaid > 0
                            ? `₹${Math.round(b.amountPaid).toLocaleString("en-IN")}`
                            : "—"}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#b91c1c",
                          }}
                        >
                          ₹{Math.round(b.amountOutstanding).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Mig 082 follow-on (Daksh round 2) — footer now
                    sums all three money columns (Total billed,
                    Paid, Outstanding) so the auditor can tie out
                    each column independently against external
                    books. Outstanding = Total − Paid; we render
                    each footer cell beneath its matching column. */}
                <tfoot
                  style={{
                    position: "sticky",
                    bottom: 0,
                    background: ACCOUNTS_TOKENS.surfaceMuted,
                  }}
                >
                  {(() => {
                    const sumTotal = focusedVendor.bills.reduce(
                      (s, b) => s + b.amountTotal,
                      0,
                    );
                    const sumPaid = focusedVendor.bills.reduce(
                      (s, b) => s + b.amountPaid,
                      0,
                    );
                    const sumOutstanding = focusedVendor.totalOutstanding;
                    return (
                      <tr>
                        <td
                          colSpan={4}
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 800,
                          }}
                        >
                          Total
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 800,
                            color: "var(--text)",
                          }}
                        >
                          ₹{Math.round(sumTotal).toLocaleString("en-IN")}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 800,
                            color: sumPaid > 0 ? "#15803d" : "var(--muted)",
                          }}
                        >
                          {sumPaid > 0
                            ? `₹${Math.round(sumPaid).toLocaleString("en-IN")}`
                            : "—"}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 800,
                            color: "#b91c1c",
                          }}
                        >
                          ₹{Math.round(sumOutstanding).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small presentation helpers ─────────────────────────────────────

const th: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "8px 10px",
  textAlign: "right",
  borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
  whiteSpace: "nowrap",
};

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SummaryTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: React.ReactNode;
  tint: string;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${tint}`,
        borderRadius: 8,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 4 }}>{value}</div>
    </div>
  );
}

function PaneHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "9px 12px",
        background: active ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.surfaceMuted,
        color: active ? "#fff" : "var(--muted)",
        border: "none",
        borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
        cursor: onClick ? "pointer" : "default",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {label}
    </button>
  );
}

function KeyHint({ k, desc }: { k: string; desc: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        background: "var(--surface-alt, #f7f5f0)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      <strong style={{ color: "var(--text)" }}>{k}</strong>
      <span>{desc}</span>
    </span>
  );
}
