"use client";

/**
 * Block Purchase client — owner/developer report of every block that
 * entered the system.
 *
 * Layout: header (back link + tabs + date filter) → summary strip →
 * day-grouped truck cards (newest first). Marble + Sandstone are two
 * tabs sharing the same date filter; each truck is a single card with
 * the participating block IDs listed as monospace pills.
 *
 * No mutations on this page — purely a read-only view.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { stoneDisplayName } from "@/lib/stone-utils";
import type {
  MarbleTruck,
  SandstoneTruck,
  StockTotals,
} from "./page";
import type { StoneCategory } from "@/lib/stone-categories";

type Tab = "marble" | "sandstone" | "all";
type DateRange = "today" | "7d" | "30d" | "all" | "custom";
type ViewMode = "logs" | "compare";

/** Stable per-vendor colour for the avatar dot. Hashed off the name. */
function vendorTone(name: string | null): string {
  if (!name) return "#94a3b8";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // Gentle saturated palette.
  const palette = [
    "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
    "#14b8a6", "#f97316", "#6366f1", "#22c55e", "#ef4444",
  ];
  return palette[h % palette.length];
}

function initialOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

/** "Wed, 5 Jun 2026" — Indian English style. */
function formatDateLong(iso: string): string {
  if (!iso) return "Unknown date";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function BlockPurchaseClient({
  marbleTrucks,
  sandstoneTrucks,
  marbleTotals,
  sandstoneTotals,
  stoneCategoryMap,
}: {
  marbleTrucks: MarbleTruck[];
  sandstoneTrucks: SandstoneTruck[];
  marbleTotals: StockTotals;
  sandstoneTotals: StockTotals;
  stoneCategoryMap: Record<string, StoneCategory>;
}) {
  void stoneCategoryMap;
  const [tab, setTab] = useState<Tab>(
    // Pick whichever has data; default to All so the user sees everything.
    marbleTrucks.length === 0 && sandstoneTrucks.length > 0
      ? "sandstone"
      : sandstoneTrucks.length === 0 && marbleTrucks.length > 0
        ? "marble"
        : "all",
  );
  const [view, setView] = useState<ViewMode>("logs");
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState<string>(isoDaysAgo(30));
  const [customTo, setCustomTo] = useState<string>(todayISO());
  // Daksh June 2026 — vendor-wise filter. "all" = no filter. List is
  // derived from EVERY truck (both stones) so the dropdown stays stable
  // regardless of the date window.
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of marbleTrucks) if (t.vendor_name) set.add(t.vendor_name);
    for (const t of sandstoneTrucks) if (t.vendor_name) set.add(t.vendor_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [marbleTrucks, sandstoneTrucks]);

  // ── Build the effective date window ────────────────────────────────
  const { fromISO, toISO } = useMemo(() => {
    if (range === "all") return { fromISO: "0000-01-01", toISO: "9999-12-31" };
    if (range === "today") return { fromISO: todayISO(), toISO: todayISO() };
    if (range === "7d") return { fromISO: isoDaysAgo(6), toISO: todayISO() };
    if (range === "30d") return { fromISO: isoDaysAgo(29), toISO: todayISO() };
    return { fromISO: customFrom, toISO: customTo };
  }, [range, customFrom, customTo]);

  // ── Filter both datasets by date window ────────────────────────────
  const filteredMarble = useMemo(() => {
    return marbleTrucks.filter((t) => {
      const d = (t.created_at ?? "").slice(0, 10);
      if (d < fromISO || d > toISO) return false;
      if (vendorFilter !== "all" && (t.vendor_name ?? "") !== vendorFilter) return false;
      return true;
    });
  }, [marbleTrucks, fromISO, toISO, vendorFilter]);

  const filteredSandstone = useMemo(() => {
    return sandstoneTrucks.filter((t) => {
      if (t.date < fromISO || t.date > toISO) return false;
      if (vendorFilter !== "all" && (t.vendor_name ?? "") !== vendorFilter) return false;
      return true;
    });
  }, [sandstoneTrucks, fromISO, toISO, vendorFilter]);

  // ── Summary KPIs for the active tab ────────────────────────────────
  const summary = useMemo(() => {
    if (tab === "marble") {
      const trucks = filteredMarble.length;
      let blocks = 0;
      let tonnes = 0;
      let cft = 0;
      for (const t of filteredMarble) {
        blocks += t.blocks.length || Number(t.num_blocks) || 0;
        tonnes += Number(t.total_tonnes) || 0;
        cft += t.totalCft;
      }
      return { trucks, blocks, tonnes, cft, showTonnes: true };
    }
    if (tab === "sandstone") {
      let blocks = 0;
      let cft = 0;
      let tonnes = 0;
      for (const t of filteredSandstone) {
        blocks += t.blocks.length;
        cft += t.totalCft;
        tonnes += t.totalTonnes;
      }
      return {
        trucks: filteredSandstone.length,
        blocks,
        tonnes,
        cft,
        showTonnes: false,
      };
    }
    // "all" — combined totals
    let trucks = filteredMarble.length + filteredSandstone.length;
    let blocks = 0;
    let tonnes = 0;
    let cft = 0;
    for (const t of filteredMarble) {
      blocks += t.blocks.length || Number(t.num_blocks) || 0;
      tonnes += Number(t.total_tonnes) || 0;
      cft += t.totalCft;
    }
    for (const t of filteredSandstone) {
      blocks += t.blocks.length;
      cft += t.totalCft;
      tonnes += t.totalTonnes;
    }
    void trucks;
    return {
      trucks,
      blocks,
      tonnes,
      cft,
      showTonnes: true,
    };
  }, [tab, filteredMarble, filteredSandstone]);

  // ── Group by date for the day separators ───────────────────────────
  // For the "all" tab a day group can mix marble + sandstone trucks; we
  // keep them as two parallel arrays in the same DayGroup so the day
  // header tallies once and the cards render in two visually-distinct
  // shapes underneath.
  type DayGroup = {
    date: string;
    marbleTrucks: MarbleTruck[];
    sandstoneTrucks: SandstoneTruck[];
    cft: number;
    blocks: number;
  };

  const dayGroups: DayGroup[] = useMemo(() => {
    const m = new Map<string, DayGroup>();
    const ensure = (date: string): DayGroup => {
      let g = m.get(date);
      if (!g) {
        g = { date, marbleTrucks: [], sandstoneTrucks: [], cft: 0, blocks: 0 };
        m.set(date, g);
      }
      return g;
    };
    if (tab === "marble" || tab === "all") {
      for (const t of filteredMarble) {
        const date = (t.created_at ?? "").slice(0, 10);
        const g = ensure(date);
        g.marbleTrucks.push(t);
        g.cft += t.totalCft;
        g.blocks += t.blocks.length || Number(t.num_blocks) || 0;
      }
    }
    if (tab === "sandstone" || tab === "all") {
      for (const t of filteredSandstone) {
        const g = ensure(t.date);
        g.sandstoneTrucks.push(t);
        g.cft += t.totalCft;
        g.blocks += t.blocks.length;
      }
    }
    return Array.from(m.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [tab, filteredMarble, filteredSandstone]);

  // ── Combined totals for the "All" tab in the Compare panel ──────────
  const combinedTotals: StockTotals = useMemo(() => ({
    purchasedBlocks: marbleTotals.purchasedBlocks + sandstoneTotals.purchasedBlocks,
    purchasedCft: marbleTotals.purchasedCft + sandstoneTotals.purchasedCft,
    purchasedTonnes: marbleTotals.purchasedTonnes + sandstoneTotals.purchasedTonnes,
    inStockBlocks: marbleTotals.inStockBlocks + sandstoneTotals.inStockBlocks,
    inStockCft: marbleTotals.inStockCft + sandstoneTotals.inStockCft,
    inStockTonnes: marbleTotals.inStockTonnes + sandstoneTotals.inStockTonnes,
    consumedBlocks: marbleTotals.consumedBlocks + sandstoneTotals.consumedBlocks,
    consumedCft: marbleTotals.consumedCft + sandstoneTotals.consumedCft,
    consumedTonnes: marbleTotals.consumedTonnes + sandstoneTotals.consumedTonnes,
  }), [marbleTotals, sandstoneTotals]);

  return (
    <section style={{ paddingBottom: 32 }}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "18px 22px",
          marginBottom: 14,
        }}
      >
        <Link
          href="/block-journey"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--muted)",
            textDecoration: "none",
            marginBottom: 8,
          }}
        >
          ← Block Journey
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Procurement
            </div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              📦 Block Purchase
            </h1>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Every block that came in — grouped truck-wise, newest first.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {/* ── Tabs ─────────────────────────────────────────────── */}
            <div
              style={{
                display: "inline-flex",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--bg)",
              }}
            >
              {(
                [
                  {
                    key: "all",
                    label: "All",
                    count: marbleTrucks.length + sandstoneTrucks.length,
                    tone: "var(--gold-dark)",
                  },
                  { key: "marble", label: "Marble", count: marbleTrucks.length, tone: "#b45309" },
                  { key: "sandstone", label: "Sandstone", count: sandstoneTrucks.length, tone: "#0ea5e9" },
                ] as const
              ).map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key as Tab)}
                    style={{
                      padding: "10px 16px",
                      fontSize: 13,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      background: active ? t.tone : "transparent",
                      color: active ? "#fff" : "var(--muted)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 0.12s",
                    }}
                  >
                    {t.label}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: active ? "rgba(255,255,255,0.22)" : "var(--surface)",
                        color: active ? "#fff" : "var(--text)",
                        border: active ? "none" : "1px solid var(--border)",
                      }}
                    >
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── View toggle: Logs vs Compare ─────────────────────── */}
            <div
              style={{
                display: "inline-flex",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--bg)",
              }}
            >
              {(
                [
                  { key: "logs", label: "📋 Daily logs" },
                  { key: "compare", label: "📊 Compare with stock" },
                ] as const
              ).map((v) => {
                const active = view === v.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setView(v.key as ViewMode)}
                    style={{
                      padding: "10px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      background: active ? "#475569" : "transparent",
                      color: active ? "#fff" : "var(--muted)",
                      transition: "background 0.12s",
                    }}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Date range chips — hidden in Compare view since the
              stock numbers are a now-snapshot, independent of date. */}
        {view === "logs" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px dashed var(--border)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginRight: 4,
            }}
          >
            Range
          </span>
          {(
            [
              { key: "today", label: "Today" },
              { key: "7d", label: "7 days" },
              { key: "30d", label: "30 days" },
              { key: "all", label: "All time" },
              { key: "custom", label: "Custom" },
            ] as const
          ).map((r) => {
            const active = range === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key as DateRange)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
                  borderRadius: 999,
                  cursor: "pointer",
                  background: active ? "var(--gold-dark)" : "var(--bg)",
                  color: active ? "#fff" : "var(--muted)",
                  transition: "all 0.12s",
                }}
              >
                {r.label}
              </button>
            );
          })}
          {range === "custom" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                max={customTo}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom}
                max={todayISO()}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
            </div>
          )}
          {/* Vendor-wise filter — dropdown so a long supplier list
              stays compact. Pushed to the right; "All vendors" clears
              it. Applies to whichever tab + date window is active. */}
          {vendorOptions.length > 0 && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: "auto",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Vendor
              </span>
              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `1px solid ${vendorFilter !== "all" ? "var(--gold-dark)" : "var(--border)"}`,
                  background: vendorFilter !== "all" ? "rgba(180,115,51,0.10)" : "var(--bg)",
                  color: "var(--text)",
                  maxWidth: 260,
                  cursor: "pointer",
                }}
              >
                <option value="all">All vendors ({vendorOptions.length})</option>
                {vendorOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        )}
      </header>

      {view === "logs" ? (
        <>
          {/* ─── Summary strip ───────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`,
              gap: 10,
              marginBottom: 16,
            }}
          >
            <StatTile
              label="Trucks"
              value={fmtInt(summary.trucks)}
              accent="var(--gold-dark)"
              icon="🚚"
            />
            <StatTile
              label="Blocks"
              value={fmtInt(summary.blocks)}
              accent={tab === "marble" ? "#b45309" : tab === "sandstone" ? "#0ea5e9" : "var(--gold-dark)"}
              icon="🧱"
            />
            {summary.showTonnes && (
              <StatTile
                label="Tonnes"
                value={fmtNum(summary.tonnes, 2)}
                accent="#475569"
                icon="⚖️"
                subtitle={tab === "all" ? "marble + sandstone" : undefined}
              />
            )}
            <StatTile
              label="CFT"
              value={fmtNum(summary.cft, 0)}
              accent="#10b981"
              icon="📐"
              subtitle={
                tab === "marble"
                  ? "@ 8 CFT / tonne"
                  : tab === "sandstone"
                    ? "L × W × H"
                    : "marble (×8) + sandstone (L×W×H)"
              }
            />
          </div>

          {/* ─── Body — day groups ─────────────────────────────── */}
          {dayGroups.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {dayGroups.map((g) => (
                <DayBlock key={g.date} group={g} showKind={tab === "all"} />
              ))}
            </div>
          )}
        </>
      ) : (
        <ComparePanel
          tab={tab}
          marbleTotals={marbleTotals}
          sandstoneTotals={sandstoneTotals}
          combinedTotals={combinedTotals}
        />
      )}
    </section>
  );
}

// ── Small components ─────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
  icon,
  subtitle,
}: {
  label: string;
  value: string;
  accent: string;
  icon: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accent,
        }}
      />
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span>{icon}</span>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: "var(--text)",
          fontFamily: "ui-monospace, monospace",
          letterSpacing: "-0.01em",
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function DayBlock({
  group,
  showKind,
}: {
  group: {
    date: string;
    marbleTrucks: MarbleTruck[];
    sandstoneTrucks: SandstoneTruck[];
    cft: number;
    blocks: number;
  };
  /** When true (the "All" tab), card cluster headers split marble vs
   *  sandstone so the viewer can tell them apart at a glance. */
  showKind: boolean;
}) {
  const truckCount = group.marbleTrucks.length + group.sandstoneTrucks.length;
  return (
    <div>
      {/* Day separator pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 1,
          padding: "4px 0",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: "var(--text)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: "6px 14px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>{formatDateLong(group.date)}</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ color: "var(--muted)", fontWeight: 700 }}>
            {truckCount} {truckCount === 1 ? "truck" : "trucks"}
          </span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ color: "var(--muted)", fontWeight: 700 }}>
            {fmtInt(group.blocks)} blocks
          </span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ color: "var(--gold-dark)", fontWeight: 800 }}>
            {fmtNum(group.cft, 0)} CFT
          </span>
        </div>
      </div>

      {/* Marble cluster */}
      {group.marbleTrucks.length > 0 && (
        <>
          {showKind && (
            <SubclusterHeader
              label="Marble"
              tone="#b45309"
              count={group.marbleTrucks.length}
            />
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 10,
              marginBottom: group.sandstoneTrucks.length > 0 ? 10 : 0,
            }}
          >
            {group.marbleTrucks.map((t) => (
              <MarbleTruckCard key={t.id} truck={t} />
            ))}
          </div>
        </>
      )}

      {/* Sandstone cluster */}
      {group.sandstoneTrucks.length > 0 && (
        <>
          {showKind && (
            <SubclusterHeader
              label="Sandstone"
              tone="#0369a1"
              count={group.sandstoneTrucks.length}
            />
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 10,
            }}
          >
            {group.sandstoneTrucks.map((t) => (
              <SandstoneTruckCard key={t.key} truck={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SubclusterHeader({
  label,
  tone,
  count,
}: {
  label: string;
  tone: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
        fontSize: 10,
        fontWeight: 800,
        color: tone,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: tone,
          borderRadius: 2,
        }}
      />
      {label}
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: tone,
          background: tone + "1a",
          padding: "1px 6px",
          borderRadius: 4,
        }}
      >
        {count}
      </span>
    </div>
  );
}

function MarbleTruckCard({ truck }: { truck: MarbleTruck }) {
  const vendorColor = vendorTone(truck.vendor_name);
  const blocks = truck.blocks;
  const blockCount = blocks.length || Number(truck.num_blocks) || 0;
  const tonnes = Number(truck.total_tonnes) || 0;
  const stoneName = stoneDisplayName(truck.stone);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${vendorColor}`,
        borderRadius: 12,
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: vendorColor + "22",
              color: vendorColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initialOf(truck.vendor_name)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={truck.vendor_name ?? ""}
            >
              {truck.vendor_name || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>No vendor</span>}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "ui-monospace, monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              🚚 {truck.truck_no || <span style={{ fontStyle: "italic" }}>No truck no.</span>}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "3px 8px",
            borderRadius: 4,
            background: "rgba(180,83,9,0.12)",
            color: "#b45309",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {stoneName}
        </span>
      </div>

      {/* Metrics row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          padding: "8px 10px",
          background: "var(--bg)",
          borderRadius: 8,
        }}
      >
        <Metric value={String(blockCount)} label="Blocks" />
        <Metric value={fmtNum(tonnes, 2)} label="Tonnes" />
        <Metric value={fmtNum(truck.totalCft, 0)} label="CFT eq" />
      </div>

      {/* Block ID pills */}
      {blocks.length > 0 && (
        <BlockIdPills ids={blocks.map((b) => b.id)} tone="#b45309" />
      )}
    </div>
  );
}

function SandstoneTruckCard({ truck }: { truck: SandstoneTruck }) {
  const vendorColor = vendorTone(truck.vendor_name);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${vendorColor}`,
        borderRadius: 12,
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: vendorColor + "22",
              color: vendorColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initialOf(truck.vendor_name)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={truck.vendor_name ?? ""}
            >
              {truck.vendor_name || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>No vendor</span>}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "ui-monospace, monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              🚚 {truck.truck_no || <span style={{ fontStyle: "italic" }}>No truck no.</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}>
          {truck.stones.slice(0, 3).map((s) => (
            <span
              key={s}
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(14,165,233,0.12)",
                color: "#0369a1",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              {stoneDisplayName(s)}
            </span>
          ))}
          {truck.stones.length > 3 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 6px",
                borderRadius: 4,
                background: "var(--bg)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              +{truck.stones.length - 3}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: truck.totalTonnes > 0 ? "1fr 1fr 1fr" : "1fr 1fr",
          gap: 8,
          padding: "8px 10px",
          background: "var(--bg)",
          borderRadius: 8,
        }}
      >
        <Metric value={String(truck.blocks.length)} label="Blocks" />
        <Metric value={fmtNum(truck.totalCft, 0)} label="CFT" />
        {truck.totalTonnes > 0 && (
          <Metric value={fmtNum(truck.totalTonnes, 2)} label="Tonnes" />
        )}
      </div>

      {truck.blocks.length > 0 && (
        <BlockIdPills ids={truck.blocks.map((b) => b.id)} tone="#0369a1" />
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: "var(--text)",
          fontFamily: "ui-monospace, monospace",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginTop: 1,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function BlockIdPills({ ids, tone }: { ids: string[]; tone: string }) {
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_LIMIT = 12;
  const visible = expanded ? ids : ids.slice(0, VISIBLE_LIMIT);
  const hidden = ids.length - visible.length;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {visible.map((id) => (
        <Link
          key={id}
          href={`/blocks/${encodeURIComponent(id)}`}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 7px",
            borderRadius: 4,
            background: tone + "12",
            color: tone,
            fontFamily: "ui-monospace, monospace",
            textDecoration: "none",
            border: `1px solid ${tone}33`,
            whiteSpace: "nowrap",
          }}
          title={`Open ${id}`}
        >
          {id}
        </Link>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 4,
            background: "var(--bg)",
            color: "var(--muted)",
            border: "1px dashed var(--border)",
            cursor: "pointer",
          }}
        >
          + {hidden} more
        </button>
      )}
      {expanded && ids.length > VISIBLE_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 4,
            background: "var(--bg)",
            color: "var(--muted)",
            border: "1px dashed var(--border)",
            cursor: "pointer",
          }}
        >
          collapse
        </button>
      )}
    </div>
  );
}

// ── Compare panel ────────────────────────────────────────────────────

function ComparePanel({
  tab,
  marbleTotals,
  sandstoneTotals,
  combinedTotals,
}: {
  tab: Tab;
  marbleTotals: StockTotals;
  sandstoneTotals: StockTotals;
  combinedTotals: StockTotals;
}) {
  // Decide which categories to show based on the active tab.
  const sections: Array<{
    title: string;
    subtitle: string;
    tone: string;
    icon: string;
    unit: "tonnes" | "cft";
    totals: StockTotals;
  }> = [];

  if (tab === "all" || tab === "marble") {
    sections.push({
      title: "Marble",
      subtitle: "Tonnes from truck bills · CFT @ 8/tonne",
      tone: "#b45309",
      icon: "⛰",
      unit: "tonnes",
      totals: marbleTotals,
    });
  }
  if (tab === "all" || tab === "sandstone") {
    sections.push({
      title: "Sandstone",
      subtitle: "Block dims (L × W × H ÷ 1728)",
      tone: "#0369a1",
      icon: "🟫",
      unit: "cft",
      totals: sandstoneTotals,
    });
  }
  if (tab === "all") {
    sections.unshift({
      title: "Total (Marble + Sandstone)",
      subtitle: "Combined CFT — marble equiv (×8) + sandstone (L×W×H)",
      tone: "var(--gold-dark)",
      icon: "📦",
      unit: "cft",
      totals: combinedTotals,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          padding: "12px 16px",
          background: "rgba(71,85,105,0.08)",
          border: "1px solid rgba(71,85,105,0.2)",
          borderRadius: 12,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text)" }}>📊 Compare</strong> — a live
        snapshot (not date-filtered). <b>Purchased</b> is everything ever
        entered. <b>In Stock</b> is what is still in the yard right now
        (status <code>available</code> or <code>reserved</code>).
        <b> Consumed</b> is blocks that have been cut. <b>Other</b> is anything
        else (discarded, or older entries without a status set).{" "}
        <i>Percentages and the bar use block counts</i> — the
        tonnes/CFT numbers above are informational and can drift on old
        entries with sketchy dimensions.
      </div>

      {sections.map((s) => (
        <CompareSection key={s.title} {...s} />
      ))}
    </div>
  );
}

function CompareSection({
  title,
  subtitle,
  tone,
  icon,
  unit,
  totals,
}: {
  title: string;
  subtitle: string;
  tone: string;
  icon: string;
  unit: "tonnes" | "cft";
  totals: StockTotals;
}) {
  const purchased = unit === "tonnes" ? totals.purchasedTonnes : totals.purchasedCft;
  const inStock = unit === "tonnes" ? totals.inStockTonnes : totals.inStockCft;
  const consumed = unit === "tonnes" ? totals.consumedTonnes : totals.consumedCft;

  // Percentages: BLOCK COUNTS — integer-clean, never thrown off by
  // legacy dimension-unit inconsistencies in the CFT column. The
  // CFT/tonnes numbers above stay as informational totals.
  const purchasedBlocks = totals.purchasedBlocks;
  const inStockBlocks = totals.inStockBlocks;
  const consumedBlocks = totals.consumedBlocks;
  const otherBlocks = Math.max(0, purchasedBlocks - inStockBlocks - consumedBlocks);

  const denomBlocks = purchasedBlocks > 0 ? purchasedBlocks : 1;
  const stockPct = Math.max(0, Math.min(100, (inStockBlocks / denomBlocks) * 100));
  const consPct = Math.max(0, Math.min(100, (consumedBlocks / denomBlocks) * 100));
  const otherPct = Math.max(0, Math.min(100, (otherBlocks / denomBlocks) * 100));

  const unitLabel = unit === "tonnes" ? "T" : "CFT";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${tone}`,
        borderRadius: 14,
        padding: "16px 20px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: tone + "22",
              color: tone,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            {icon}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
              {title}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              {subtitle}
            </div>
          </div>
        </div>
      </div>

      {/* 3-up metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <CompareMetric
          label="Purchased"
          value={fmtNum(purchased, unit === "tonnes" ? 2 : 0)}
          unit={unitLabel}
          subValue={`${fmtInt(totals.purchasedBlocks)} blocks`}
          tone={tone}
          isPrimary
        />
        <CompareMetric
          label="In stock"
          value={fmtNum(inStock, unit === "tonnes" ? 2 : 0)}
          unit={unitLabel}
          subValue={`${fmtInt(totals.inStockBlocks)} blocks · ${stockPct.toFixed(0)}%`}
          tone="#10b981"
        />
        <CompareMetric
          label="Consumed"
          value={fmtNum(consumed, unit === "tonnes" ? 2 : 0)}
          unit={unitLabel}
          subValue={`${fmtInt(totals.consumedBlocks)} blocks · ${consPct.toFixed(0)}%`}
          tone="#94a3b8"
        />
      </div>

      {/* Visual ratio bar — based on block COUNT */}
      <div
        style={{
          display: "flex",
          height: 14,
          borderRadius: 7,
          overflow: "hidden",
          background: "var(--bg)",
          border: "1px solid var(--border)",
        }}
        title={`In stock ${stockPct.toFixed(1)}% · Consumed ${consPct.toFixed(1)}%${otherBlocks > 0 ? ` · Other ${otherPct.toFixed(1)}%` : ""} — by block count`}
      >
        <div
          style={{
            width: `${stockPct}%`,
            background: "#10b981",
            transition: "width 0.3s",
          }}
        />
        <div
          style={{
            width: `${consPct}%`,
            background: "#94a3b8",
            transition: "width 0.3s",
          }}
        />
        {otherPct > 0 && (
          <div
            style={{
              width: `${otherPct}%`,
              background: "#f59e0b",
              transition: "width 0.3s",
            }}
            title={`Other (status not set / discarded): ${otherPct.toFixed(1)}%`}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          marginTop: 4,
        }}
      >
        <span style={{ color: "#059669" }}>● In stock · {fmtInt(inStockBlocks)} blocks</span>
        <span style={{ color: "#64748b" }}>● Consumed · {fmtInt(consumedBlocks)} blocks</span>
        {otherBlocks > 0 && (
          <span style={{ color: "#b45309" }}>● Other · {fmtInt(otherBlocks)} blocks</span>
        )}
      </div>

      {/* Data quality note — only if there's an "Other" bucket */}
      {otherBlocks > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: 8,
            fontSize: 11,
            color: "#92400e",
            lineHeight: 1.5,
          }}
        >
          <strong>{fmtInt(otherBlocks)} block{otherBlocks === 1 ? "" : "s"}</strong>{" "}
          aren&apos;t classified as in-stock or consumed — most likely older
          entries with status not set, or blocks marked discarded.
        </div>
      )}
    </div>
  );
}

function CompareMetric({
  label,
  value,
  unit,
  subValue,
  tone,
  isPrimary,
}: {
  label: string;
  value: string;
  unit: string;
  subValue: string;
  tone: string;
  isPrimary?: boolean;
}) {
  return (
    <div
      style={{
        background: isPrimary ? tone + "10" : "var(--bg)",
        border: `1px solid ${isPrimary ? tone + "33" : "var(--border)"}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: tone,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <span
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
          {unit}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        {subValue}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px dashed var(--border)",
        borderRadius: 14,
        padding: "44px 20px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        No {tab === "marble" ? "marble trucks" : "sandstone purchases"} in this range
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Try widening the date filter, or switch to the other tab.
      </div>
    </div>
  );
}
