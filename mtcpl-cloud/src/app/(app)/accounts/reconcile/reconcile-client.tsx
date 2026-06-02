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

export function ReconcileClient({ bills }: { bills: ReconcileBillRow[] }) {
  // ── Aggregate by vendor (memoised) ────────────────────────────────
  const vendorList: VendorAgg[] = useMemo(() => {
    const m = new Map<string, VendorAgg>();
    for (const b of bills) {
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
  }, [bills]);

  const grandTotal = useMemo(
    () => vendorList.reduce((s, v) => s + v.totalOutstanding, 0),
    [vendorList],
  );

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

  const totalBills = bills.length;
  const totalVendors = vendorList.length;
  const heldGrand = vendorList.reduce((s, v) => s + v.totalHeld, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Summary strip — grand total + counts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        <SummaryTile
          label="Total outstanding"
          value={<Money value={grandTotal} size="large" tone="danger" />}
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
                <tfoot
                  style={{
                    position: "sticky",
                    bottom: 0,
                    background: ACCOUNTS_TOKENS.surfaceMuted,
                  }}
                >
                  <tr>
                    <td colSpan={6} style={{ ...td, textAlign: "right", fontWeight: 800 }}>
                      Total
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 800,
                        color: "#b91c1c",
                      }}
                    >
                      ₹{Math.round(focusedVendor.totalOutstanding).toLocaleString("en-IN")}
                    </td>
                  </tr>
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
