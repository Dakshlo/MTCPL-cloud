"use client";

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";

/** Mig follow-on (Daksh, May 2026) — derive the active month value
 *  for the Month dropdown from the dateFrom/dateTo range. If the
 *  range exactly matches a current-year calendar month (or the
 *  current month clamped to today), return that month as 1-12 so
 *  the dropdown shows the right option highlighted. Otherwise
 *  return "" (the "All months" option). Keeps the dropdown in sync
 *  if the user nudges the date inputs directly. */
function monthFromRange(from: string, to: string): string {
  if (!from || !to) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!m || !n) return "";
  const yr = Number(m[1]);
  const fromMonth = Number(m[2]);
  const fromDay = Number(m[3]);
  const toYear = Number(n[1]);
  const toMonth = Number(n[2]);
  const toDay = Number(n[3]);
  const now = new Date();
  if (yr !== now.getFullYear() || toYear !== yr) return "";
  if (fromMonth !== toMonth) return "";
  if (fromDay !== 1) return "";
  const lastDayOfMonth = new Date(yr, fromMonth, 0).getDate();
  const isCurrentMonth =
    fromMonth === now.getMonth() + 1;
  const expectedToDay = isCurrentMonth ? now.getDate() : lastDayOfMonth;
  if (toDay !== expectedToDay) return "";
  return String(fromMonth);
}
import Link from "next/link";
import {
  ALLOWED_YARDS,
  yardLabel,
  yardShortLabel,
  FACILITIES,
  YARDS_BY_FACILITY,
  facilityLabel,
  type Facility,
} from "@/lib/yards";
import { getStonePalette, stoneDisplayName } from "@/lib/stone-utils";
import { blockStatusLabel, blockStatusBadge, isReusedBlock } from "@/lib/blocks";
import { cftEquivFromTonnes, type StoneCategory } from "@/lib/stone-categories";

type Block = {
  id: string;
  stone: string;
  yard: number;
  category: string | null;
  quality: string | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes?: number | string | null;
  truck_entry_id?: string | null;
  status: string;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (isToday) return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "2-digit" });
}

function calcCft(l: number, w: number, h: number) {
  return (l * w * h) / 1728;
}

/** CFT for any block — real CFT for sandstone, tonnes→CFT-equiv for
 *  marble. Lets sorting, totals, and Excel export treat both uniformly. */
function blockCft(b: Block, isMarble: boolean): number {
  if (isMarble) {
    const t = Number(b.tonnes);
    return Number.isFinite(t) && t > 0 ? cftEquivFromTonnes(t) : 0;
  }
  return calcCft(Number(b.length_ft) || 0, Number(b.width_ft) || 0, Number(b.height_ft) || 0);
}

type SortCol = "id" | "stone" | "yard" | "cft" | "status" | "vendor_name" | "created_at" | "updated_at";

export function ReportClient({
  blocks,
  stoneNames,
  stoneCategoryMap = {},
  stonePalettes = [],
}: {
  blocks: Block[];
  stoneNames?: string[];
  stoneCategoryMap?: Record<string, StoneCategory>;
  /** 3-face stone colours for the yard-preview tiles (see stone-utils). */
  stonePalettes?: Array<{ name: string; color_top: string; color_front: string; color_side: string }>;
}) {
  const ALL_STONES = stoneNames && stoneNames.length > 0 ? stoneNames : ["PinkStone", "WhiteStone"];
  const today = new Date().toISOString().slice(0, 10);

  // Filters. Default = only 'available' — when the report loads, people need
  // to see what's actually in the yard right now, not historical totals that
  // get confusing ("why is our stock so huge?"). Other filters are additive.
  const [statusFilter, setStatusFilter] = useState<string[]>(["available"]);
  // Fresh vs Restocked (Reused). A whole dimension that used to be visible only
  // as a "↻" glyph buried in the table — so "show me the restocked blocks in
  // the yard right now" had no control at all. "Reused"/available is a real,
  // frequently-asked slice (162 blocks at time of writing).
  const [categoryFilter, setCategoryFilter] = useState<"all" | "Fresh" | "Reused">("all");
  const [stoneFilter, setStoneFilter] = useState("all");
  const [yardFilter, setYardFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [vendorSearch, setVendorSearch] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sort
  const [sortBy, setSortBy] = useState<SortCol>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [previewOpen, setPreviewOpen] = useState(false);

  const [exporting, setExporting] = useState(false);

  // Unique vendors for quick filter. Dedupe is case + whitespace
  // insensitive so "Ansu Marble" and "ANSU MARBLE" collapse into one
  // entry (keeps the first-encountered casing as display). Belt-and-
  // braces in case migration 010 missed a stray row, or a pre-dedup
  // action writes a new variant before the admin runs the migration.
  const vendors = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const b of blocks) {
      const v = b.vendor_name?.trim();
      if (!v) continue;
      const key = v.replace(/\s+/g, "").toUpperCase();
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()].sort();
  }, [blocks]);

  // Everything EXCEPT the status + category dimensions. The stock-state tiles
  // and the Fresh/Restocked toggle count against this, so each shows what you
  // would get if you picked it — standard faceted-filter behaviour, and the
  // thing that turns the status row from a set of blind pills into a live
  // read of the yard.
  const baseRows = useMemo(() => {
    let rows = [...blocks];
    if (stoneFilter !== "all") rows = rows.filter(b => b.stone === stoneFilter);
    if (yardFilter !== "all") rows = rows.filter(b => String(b.yard) === yardFilter);
    if (qualityFilter === "A") rows = rows.filter(b => b.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter(b => b.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter(b => !b.quality);
    if (vendorSearch) rows = rows.filter(b => b.vendor_name?.toLowerCase().includes(vendorSearch.toLowerCase()));
    if (blockSearch) rows = rows.filter(b => b.id.toLowerCase().includes(blockSearch.toLowerCase()));
    if (dateFrom) rows = rows.filter(b => b.created_at && b.created_at >= dateFrom);
    if (dateTo) rows = rows.filter(b => b.created_at && b.created_at <= dateTo + "T23:59:59Z");
    return rows;
  }, [blocks, stoneFilter, yardFilter, qualityFilter, vendorSearch, blockSearch, dateFrom, dateTo]);

  const matchesCategory = (b: Block) =>
    categoryFilter === "all" ? true : (b.category ?? "Fresh") === categoryFilter;

  // Count per status, honouring the current category choice.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { available: 0, reserved: 0, consumed: 0, discarded: 0 };
    for (const b of baseRows) if (matchesCategory(b)) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [baseRows, categoryFilter]);

  // Count per category, honouring the current status choice — the Fresh vs
  // Restocked split of whatever statuses are selected.
  const categoryCounts = useMemo(() => {
    const inStatus = (b: Block) => statusFilter.length === 0 || statusFilter.includes(b.status);
    let all = 0, fresh = 0, reused = 0;
    for (const b of baseRows) {
      if (!inStatus(b)) continue;
      all++;
      if ((b.category ?? "Fresh") === "Reused") reused++; else fresh++;
    }
    return { all, fresh, reused };
  }, [baseRows, statusFilter]);

  // The headline slice this makeover exists for: restocked blocks sitting in
  // the yard available right now.
  const restockedAvailableNow = useMemo(
    () => baseRows.filter(b => b.status === "available" && b.category === "Reused").length,
    [baseRows],
  );

  // Available stock by stone — the one-glance "what is actually in the yard,
  // by material" KPI. Always available-only (that is the whole question) and
  // from the full set, so it is a stable reference regardless of the table's
  // current filters. Marble uses its tonnes→CFT equivalent so the bars are
  // comparable across materials.
  const availableByStone = useMemo(() => {
    const m = new Map<string, { count: number; cft: number; marble: boolean }>();
    for (const b of blocks) {
      if (b.status !== "available") continue;
      const marble = stoneCategoryMap[b.stone] === "marble";
      const cur = m.get(b.stone) ?? { count: 0, cft: 0, marble };
      cur.count += 1;
      cur.cft += blockCft(b, marble);
      m.set(b.stone, cur);
    }
    return [...m.entries()]
      .map(([stone, v]) => ({ stone, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [blocks, stoneCategoryMap]);
  const maxStoneCount = availableByStone[0]?.count ?? 1;
  const totalAvailable = availableByStone.reduce((s, r) => s + r.count, 0);

  const filtered = useMemo(() => {
    let rows = baseRows.filter(matchesCategory);
    if (statusFilter.length > 0) rows = rows.filter(b => statusFilter.includes(b.status));

    rows = [...rows];
    rows.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortBy === "cft") {
        av = blockCft(a, stoneCategoryMap[a.stone] === "marble");
        bv = blockCft(b, stoneCategoryMap[b.stone] === "marble");
      } else if (sortBy === "yard") {
        av = a.yard;
        bv = b.yard;
      } else {
        av = String((a as Record<string, unknown>)[sortBy] ?? "");
        bv = String((b as Record<string, unknown>)[sortBy] ?? "");
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [baseRows, statusFilter, categoryFilter, sortBy, sortDir]);

  // Combined accumulator — CFT (all rows) plus tonnes + marble count
  // (only marble rows) so the header can show "Total tonnes X.XXX T"
  // alongside "Total volume Y CFT" whenever marble is in the filtered
  // view. Sandstone-only filters keep the UI clean (marbleCount === 0).
  const totals = filtered.reduce(
    (acc, b) => {
      const isMarble = stoneCategoryMap[b.stone] === "marble";
      acc.cft += blockCft(b, isMarble);
      if (isMarble) {
        acc.marbleCount += 1;
        if (b.tonnes != null) acc.tonnes += Number(b.tonnes);
      }
      return acc;
    },
    { cft: 0, tonnes: 0, marbleCount: 0 }
  );
  // Keep totalCft around in case other sites in this file reference it.
  const totalCft = totals.cft;

  // Status toggle
  function toggleStatus(s: string) {
    setStatusFilter(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  }

  function clearAll() {
    // Snap back to the opening view: show only available blocks, no other
    // filters. If someone genuinely wants everything they can un-tick
    // Available after this.
    setStatusFilter(["available"]);
    setCategoryFilter("all");
    setStoneFilter("all");
    setYardFilter("all");
    setQualityFilter("all");
    setVendorSearch("");
    setBlockSearch("");
    setDateFrom("");
    setDateTo("");
  }

  // Column sort
  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortBy !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
    return <span style={{ color: "var(--gold)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (statusFilter.length === 1) params.set("status", statusFilter[0]);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (stoneFilter !== "all") params.set("stone", stoneFilter);
      if (yardFilter !== "all") params.set("yard", yardFilter);
      if (vendorSearch) params.set("vendor", vendorSearch);
      if (blockSearch) params.set("block", blockSearch);

      const res = await fetch(`/api/blocks/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const label = dateFrom && dateTo ? `${dateFrom}-to-${dateTo}` : "all";
      link.download = `blocks-report-${label}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {/* ── Available stock by stone (KPI) ──
          One-glance read of what is in the yard, by material. Each bar is a
          shortcut: tap it to filter the table to that stone's available
          blocks. Sandstone bars are gold, marble amber, so the two materials
          read apart at a distance. */}
      {availableByStone.length > 0 && (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 14,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>📦 Available stock by stone</span>
            <span className="muted" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
              {totalAvailable} blocks in the yard · tap a bar to filter
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {availableByStone.map(({ stone, count, cft, marble }) => {
              const accent = marble ? "#b45309" : "var(--gold)";
              const active = stoneFilter === stone;
              return (
                <button
                  key={stone}
                  type="button"
                  onClick={() => { setStoneFilter(active ? "all" : stone); setStatusFilter(["available"]); setCategoryFilter("all"); }}
                  title={`Show available ${stone} blocks (${count})`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(96px,auto) 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    width: "100%",
                    padding: "3px 6px",
                    border: "none",
                    borderRadius: 6,
                    background: active ? "var(--surface-alt)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: active ? 800 : 600,
                    color: active ? accent : "var(--text)", whiteSpace: "nowrap",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    {stone}
                    {marble && <span style={{ fontSize: 9 }}>🗿</span>}
                  </span>
                  <span style={{ display: "block", height: 16, background: "var(--surface-alt)", borderRadius: 4, overflow: "hidden" }}>
                    <span style={{
                      display: "block", height: "100%",
                      width: `${Math.max(3, (count / maxStoneCount) * 100)}%`,
                      background: accent,
                      opacity: active ? 1 : 0.82,
                      borderRadius: 4,
                      transition: "width .2s",
                    }} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {count}
                    <span className="muted" style={{ fontWeight: 500, marginLeft: 5 }}>
                      {cft > 0 ? `${Math.round(cft).toLocaleString("en-IN")} CFT` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter Panel ── */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 18px",
        marginBottom: 14,
      }}>
        {/* ── Stock snapshot ──
            The four statuses as live-count tiles instead of blind pills, so
            the row reads as the state of the yard at a glance. Each tile is a
            multi-select filter (tap to add/remove). The Available tile also
            splits Fresh vs Restocked underneath. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {([
            { s: "available", label: "Available", accent: "#15803d" },
            { s: "reserved",  label: "In Progress", accent: "#b45309" },
            { s: "consumed",  label: "Consumed", accent: "#6b7280" },
            { s: "discarded", label: "Deleted", accent: "#b91c1c" },
          ] as { s: string; label: string; accent: string }[]).map(({ s, label, accent }) => {
            const on = statusFilter.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                title={`${on ? "Hide" : "Show"} ${label.toLowerCase()} blocks`}
                style={{
                  flex: "1 1 130px",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1.5px solid ${on ? accent : "var(--border)"}`,
                  background: on ? `${accent}14` : "var(--surface-alt)",
                  transition: "border-color .12s, background .12s",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: on ? accent : "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                    {statusCounts[s] ?? 0}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {label}
                  </span>
                </div>
                {s === "available" && categoryFilter === "all" && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                    Fresh {statusCounts.available - restockedAvailableNow} · ↻ Restocked {restockedAvailableNow}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>

          {/* Fresh vs Restocked — the dimension that used to be a glyph in the
              table. "Restocked" = Reused, a block that came back available
              after an earlier cut. */}
          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Type</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {([
                { v: "all" as const, label: `All (${categoryCounts.all})` },
                { v: "Fresh" as const, label: `Fresh (${categoryCounts.fresh})` },
                { v: "Reused" as const, label: `↻ Restocked (${categoryCounts.reused})` },
              ]).map((o, i) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setCategoryFilter(o.v)}
                  style={{
                    fontSize: 12,
                    fontWeight: categoryFilter === o.v ? 800 : 500,
                    padding: "7px 13px",
                    border: "none",
                    borderLeft: i === 0 ? "none" : "1px solid var(--border)",
                    cursor: "pointer",
                    background: categoryFilter === o.v ? "var(--gold)" : "transparent",
                    color: categoryFilter === o.v ? "#fff" : "var(--text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stone */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Stone</span>
            <select value={stoneFilter} onChange={e => setStoneFilter(e.target.value)}>
              <option value="all">All Stones</option>
              {ALL_STONES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          {/* Yard */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Yard</span>
            <select value={yardFilter} onChange={e => setYardFilter(e.target.value)}>
              <option value="all">All Yards</option>
              {ALLOWED_YARDS.map(y => <option key={y} value={String(y)}>{yardLabel(y)}</option>)}
            </select>
          </label>

          {/* Quality */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quality</span>
            <select value={qualityFilter} onChange={e => setQualityFilter(e.target.value)}>
              <option value="all">All Grades</option>
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
              <option value="none">Unspecified</option>
            </select>
          </label>

          {/* Vendor dropdown (from data) */}
          <label className="stack" style={{ flex: "1 1 150px" }}>
            <span>Vendor</span>
            <select value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}>
              <option value="">All Vendors</option>
              {vendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>

          {/* Block code search */}
          <label className="stack" style={{ flex: "1 1 130px" }}>
            <span>Block Code</span>
            <input
              value={blockSearch}
              onChange={e => setBlockSearch(e.target.value)}
              placeholder="Search code…"
              style={{ fontFamily: "ui-monospace, monospace" }}
            />
          </label>

          {/* Month picker (Daksh, May 2026) — quick way to scope the
              report to a single month of the current year. Picking
              "May" while today is 17 May → from = 2026-05-01,
              to = 2026-05-17 (current month clamped to today). Past
              months use the full calendar month; future months
              clamp the range so the table just shows zero rows
              without throwing. Resets dateFrom + dateTo. */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Month</span>
            <select
              value={monthFromRange(dateFrom, dateTo)}
              onChange={(e) => {
                const m = e.target.value;
                if (m === "") {
                  setDateFrom("");
                  setDateTo("");
                  return;
                }
                const mIdx = Number(m); // 1-12
                const now = new Date();
                const yr = now.getFullYear();
                const firstDay = new Date(yr, mIdx - 1, 1);
                const lastDayOfMonth = new Date(yr, mIdx, 0); // day 0 of next month = last of this
                // Clamp: if this is the current (or later) month, the
                // upper bound becomes today; for past months it's the
                // actual month end.
                const upper = lastDayOfMonth.getTime() > now.getTime()
                  ? now
                  : lastDayOfMonth;
                const fmt = (d: Date) =>
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                setDateFrom(fmt(firstDay));
                setDateTo(fmt(upper));
              }}
              style={{ width: 150 }}
            >
              <option value="">All months</option>
              {(() => {
                const currentMonth = new Date().getMonth() + 1;
                return [
                  "January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December",
                ].map((name, i) => {
                  const m = i + 1;
                  // Mig follow-on (Daksh): mark the current month with
                  // a small dot suffix so it's always easy to spot
                  // even when a different month is currently selected.
                  const label = m === currentMonth ? `${name} ●` : name;
                  return (
                    <option key={name} value={m}>
                      {label}
                    </option>
                  );
                });
              })()}
            </select>
          </label>

          {/* Date range */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Added From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 140 }} />
          </label>
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Added To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 140 }} />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button type="button" className="ghost-button" onClick={clearAll}>Clear All</button>
          </div>
        </div>

        {/* Quick presets */}
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Quick:</span>

          {/* The headline view this makeover adds — restocked stock that is
              available in the yard right now, one tap. Styled apart from the
              plain presets so it reads as a feature, not another chip. */}
          <button
            type="button"
            onClick={() => { setStatusFilter(["available"]); setCategoryFilter("Reused"); }}
            style={{
              fontSize: 11.5, fontWeight: 800, padding: "4px 12px", borderRadius: 20,
              border: "1.5px solid #15803d", background: "rgba(21,128,61,0.10)", color: "#15803d",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            ↻ Restocked · available now ({restockedAvailableNow})
          </button>

          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />

          {[
            { label: "Available only", fn: () => { setStatusFilter(["available"]); setCategoryFilter("all"); } },
            { label: "Active (available + in progress)", fn: () => { setStatusFilter(["available", "reserved"]); setCategoryFilter("all"); } },
            { label: "Consumed only", fn: () => setStatusFilter(["consumed"]) },
            { label: "Deleted only", fn: () => setStatusFilter(["discarded"]) },
            { label: "Last 7 days", fn: () => { setDateFrom(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
            { label: "Last 30 days", fn: () => { setDateFrom(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
            { label: "Last 90 days", fn: () => { setDateFrom(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
          ].map(p => (
            <button
              key={p.label}
              type="button"
              className="ghost-button"
              style={{ fontSize: 11, padding: "2px 9px" }}
              onClick={p.fn}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary + Export ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <p className="muted" style={{ fontSize: 13 }}>
          Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {blocks.length} blocks ·{" "}
          Total volume <strong style={{ color: "var(--text)" }}>{totalCft.toFixed(2)} CFT</strong>
          {totals.marbleCount > 0 && (
            <>
              {" · "}
              Total tonnes <strong style={{ color: "var(--text)" }}>{totals.tonnes.toFixed(3)} T</strong>
            </>
          )}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Yard preview (Daksh, Aug 2026): a cinema view of the
              CURRENT filter — MTCPL and RIICO as separate areas, each
              yard a room, every block a tile in its real stone colour. */}
          <button
            className="secondary-button"
            type="button"
            onClick={() => setPreviewOpen(true)}
            style={{ gap: 6 }}
          >
            🎬 Preview
          </button>
          <button className="primary-button" type="button" onClick={handleExport} disabled={exporting} style={{ gap: 6 }}>
            {exporting ? "Exporting…" : "⬇ Export to Excel"}
          </button>
        </div>
      </div>

      {previewOpen && (
        <YardCinema
          blocks={filtered}
          palettes={stonePalettes}
          stoneCategoryMap={stoneCategoryMap}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* ── Table ── */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)", borderBottom: "2px solid var(--border)" }}>
              {([
                { label: "Block Code", col: "id" as SortCol },
                { label: "Stone", col: "stone" as SortCol },
                { label: "Yard", col: "yard" as SortCol },
                { label: "Dimensions (in)", col: null },
                { label: "CFT", col: "cft" as SortCol },
                { label: "Quality", col: null },
                { label: "Status", col: "status" as SortCol },
                { label: "Truck No.", col: null },
                { label: "Vendor", col: "vendor_name" as SortCol },
                { label: "Bill No.", col: null },
                { label: "Added", col: "created_at" as SortCol },
                { label: "Last Updated", col: "updated_at" as SortCol },
              ] as { label: string; col: SortCol | null }[]).map(({ label, col }) => (
                <th
                  key={label}
                  onClick={col ? () => toggleSort(col) : undefined}
                  style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: 11,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    cursor: col ? "pointer" : "default",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {label} {col && <SortIcon col={col} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                  No blocks match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((b, i) => {
                const isMarble = stoneCategoryMap[b.stone] === "marble";
                const cft = blockCft(b, isMarble);
                const tonnesNum = b.tonnes != null ? Number(b.tonnes) : null;
                return (
                  <tr
                    key={b.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)",
                    }}
                  >
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {b.id}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {b.stone}
                      {isMarble && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: "#b45309",
                            background: "rgba(180,83,9,0.12)",
                            padding: "1px 5px",
                            borderRadius: 3,
                            marginLeft: 5,
                            letterSpacing: "0.04em",
                          }}
                        >
                          🗿 MARBLE
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>{yardShortLabel(b.yard)}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {isMarble && tonnesNum != null && tonnesNum > 0 ? (
                        <span style={{ fontFamily: "ui-monospace, monospace", color: "#b45309", fontWeight: 600 }}>
                          {tonnesNum.toFixed(3)} T
                        </span>
                      ) : b.length_ft && b.width_ft && b.height_ft ? (
                        <>
                          {Number(b.length_ft)} × {Number(b.width_ft)} × {Number(b.height_ft)}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {cft > 0 ? cft.toFixed(2) : <span className="muted">—</span>}
                      {isMarble && cft > 0 && (
                        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>
                          (equiv)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {b.quality ? (
                        <span className={`role-pill ${b.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                          Grade {b.quality}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span
                        className={`role-pill ${blockStatusBadge(b.status, b.category)}`}
                        title={isReusedBlock(b.category) ? "Re-stocked from a previous cut — available but not brand-new" : undefined}
                      >
                        {isReusedBlock(b.category) && b.status === "available" ? "↻ " : ""}
                        {blockStatusLabel(b.status, b.category)}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{b.truck_no || "—"}</td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{b.vendor_name || "—"}</td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{b.bill_no || "—"}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>{fmtDate(b.created_at)}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>{fmtDate(b.updated_at)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Columns: Block Code · Stone · Yard · Dimensions · CFT · Status · Truck No. · Vendor · Bill No. · Added Date · Last Updated
      </p>
    </div>
  );
}

// ── Yard preview — "cinema" (Daksh, Aug 2026) ──────────────────────
//
// v2 (Daksh): "make UI theme white, show RIICO and MTCPL on different
// pages — first MTCPL, we swipe or arrow right, then RIICO. In a yard,
// group stone-wise, and yard-wise show data on top."
//
// So: a light full-screen stage, ONE facility per page (segmented tabs,
// ← → keys, swipe, and edge arrows all switch), each yard card leads
// with its own numbers, and inside a yard the tiles cluster by stone
// with a labelled header per cluster. Tiles keep the stone's real
// 3-face palette and volume-scaled size; status shows as treatment
// (reserved = gold ring, consumed = faded, deleted = faded + red).
// Draws whatever the report is currently FILTERED to.
//
// Portaled to <body>: hover-lift cards create transformed ancestors,
// and a transform becomes the containing block for position:fixed —
// the nested-modal jitter this codebase has been bitten by before.

type CinemaProps = {
  blocks: Block[];
  palettes: Array<{ name: string; color_top: string; color_front: string; color_side: string }>;
  stoneCategoryMap: Record<string, StoneCategory>;
  onClose: () => void;
};

function YardCinema({ blocks, palettes, stoneCategoryMap, onClose }: CinemaProps) {
  const [facility, setFacility] = useState<Facility>("mtcpl");
  const [picked, setPicked] = useState<Block | null>(null);
  const [touchX, setTouchX] = useState<number | null>(null);

  const go = (dir: 1 | -1) => {
    const i = FACILITIES.indexOf(facility);
    const next = FACILITIES[Math.min(FACILITIES.length - 1, Math.max(0, i + dir))];
    if (next !== facility) {
      setFacility(next);
      setPicked(null);
    }
  };

  // Esc closes; ← → page between facilities; the page behind must not
  // scroll. Lock <html>, not <body> — this app scrolls on the document
  // element.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, facility]);

  const volumeOf = (b: Block): number => {
    if (stoneCategoryMap[b.stone] === "marble") {
      return cftEquivFromTonnes(Number(b.tonnes) || 0) ?? 0;
    }
    const l = Number(b.length_ft) || 0;
    const w = Number(b.width_ft) || 0;
    const h = Number(b.height_ft) || 0;
    return (l * w * h) / 1728;
  };

  // Tile side grows with the cube root of volume — a 60 CFT block
  // reads clearly bigger than a 10 CFT one without dwarfing the room.
  const sideOf = (vol: number) => Math.max(14, Math.min(44, Math.round(10 + Math.cbrt(vol) * 6)));

  const statusStyle = (s: string): React.CSSProperties => {
    if (s === "reserved") return { outline: "2px solid var(--gold)", outlineOffset: 1 };
    if (s === "consumed") return { opacity: 0.3 };
    if (s === "discarded") return { opacity: 0.22, outline: "2px solid #b91c1c", outlineOffset: 1 };
    return {};
  };

  /** yard → stone → blocks, so a yard renders as labelled stone
   *  clusters (biggest cluster first) instead of one mixed heap. */
  const yardStoneGroups = useMemo(() => {
    const m = new Map<number, Map<string, Block[]>>();
    for (const b of blocks) {
      const y = Number(b.yard);
      if (!m.has(y)) m.set(y, new Map());
      const g = m.get(y)!;
      if (!g.has(b.stone)) g.set(b.stone, []);
      g.get(b.stone)!.push(b);
    }
    return m;
  }, [blocks]);

  const yardStats = (y: number) => {
    const g = yardStoneGroups.get(y);
    let n = 0;
    let cft = 0;
    for (const list of g?.values() ?? []) {
      for (const b of list) {
        n += 1;
        cft += volumeOf(b);
      }
    }
    return { n, cft };
  };

  const facilityStats = (f: Facility) => {
    let n = 0;
    let cft = 0;
    for (const y of YARDS_BY_FACILITY[f]) {
      const s = yardStats(y);
      n += s.n;
      cft += s.cft;
    }
    return { n, cft };
  };

  // Legend = stones on the CURRENT facility page, biggest count first.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const y of YARDS_BY_FACILITY[facility]) {
      for (const [stone, list] of yardStoneGroups.get(y) ?? []) {
        counts.set(stone, (counts.get(stone) ?? 0) + list.length);
      }
    }
    return [...counts.entries()].sort((a, z) => z[1] - a[1]);
  }, [facility, yardStoneGroups]);

  const fTotals = facilityStats(facility);
  const idx = FACILITIES.indexOf(facility);

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Yard preview"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        color: "var(--text)",
      }}
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (dx < -60) go(1);
        if (dx > 60) go(-1);
        setTouchX(null);
      }}
    >
      <style>{`
        .yc-page { animation: ycIn .28s cubic-bezier(.22,1,.36,1) both; }
        @keyframes ycIn { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
        .yc-arrow { transition: background .12s ease, transform .12s ease, box-shadow .12s ease; }
        .yc-arrow:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(45,36,16,0.16); background: var(--surface); }
        .yc-arrow:disabled { opacity: .3; cursor: default; }
        @media (prefers-reduced-motion: reduce) { .yc-page { animation: none; } }
      `}</style>

      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold-dark)" }}>
          🎬 Yard preview
        </div>

        {/* Facility pager tabs */}
        <div style={{ display: "inline-flex", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: 4, gap: 3 }}>
          {FACILITIES.map((f) => {
            const t = facilityStats(f);
            const active = f === facility;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFacility(f);
                  setPicked(null);
                }}
                style={{
                  padding: "7px 16px",
                  fontSize: 12.5,
                  fontWeight: 800,
                  border: "none",
                  borderRadius: 999,
                  cursor: active ? "default" : "pointer",
                  background: active ? (f === "riico" ? "#7c3aed" : "var(--gold)") : "transparent",
                  color: active ? "#fff" : "var(--muted)",
                }}
              >
                {facilityLabel(f)} · {t.n}
              </button>
            );
          })}
        </div>

        <span style={{ fontSize: 12, color: "var(--muted)" }}>swipe or use ← → to change site</span>

        {/* Legend for the current page */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginLeft: "auto" }}>
          {legend.map(([stone, n]) => {
            const p = getStonePalette(stone, palettes);
            return (
              <span key={stone} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: p.top, border: `1.5px solid ${p.front}`, display: "inline-block" }} />
                {stoneDisplayName(stone)} · {n}
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Stage: ONE facility per page ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        {/* Left arrow */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 6px 0 14px" }}>
          <button
            type="button"
            className="yc-arrow"
            onClick={() => go(-1)}
            disabled={idx === 0}
            aria-label="Previous site"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 17,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(45,36,16,0.08)",
            }}
          >
            ←
          </button>
        </div>

        <div key={facility} className="yc-page" style={{ flex: 1, minWidth: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "18px 8px 24px" }}>
          {/* Facility masthead — the page's own numbers, big and first. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", margin: "0 8px 14px" }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: facility === "riico" ? "#7c3aed" : "var(--gold-dark)" }}>
              {facilityLabel(facility)}
            </span>
            <span style={{ fontSize: 13.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {fTotals.n} block{fTotals.n === 1 ? "" : "s"} · {fTotals.cft.toFixed(0)} CFT
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {idx === 0 ? "page 1 of 2 · RIICO →" : "page 2 of 2 · ← MTCPL"}
            </span>
          </div>

          {/* Yard cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, padding: "0 8px" }}>
            {YARDS_BY_FACILITY[facility].map((y) => {
              const stats = yardStats(y);
              const groups = [...(yardStoneGroups.get(y) ?? new Map<string, Block[]>()).entries()].sort(
                (a, z) => z[1].length - a[1].length,
              );
              return (
                <div
                  key={y}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    boxShadow: "0 1px 2px rgba(45,36,16,0.05), 0 8px 24px rgba(45,36,16,0.05)",
                    overflow: "hidden",
                  }}
                >
                  {/* Yard data ON TOP (Daksh) */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border)",
                      background: "var(--surface-alt)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{yardLabel(y)}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {stats.n === 0 ? "empty" : `${stats.n} blocks · ${stats.cft.toFixed(0)} CFT`}
                    </span>
                  </div>

                  {/* Stone-wise clusters */}
                  <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12, minHeight: 64 }}>
                    {groups.length === 0 && (
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>No blocks here under the current filter.</span>
                    )}
                    {groups.map(([stone, list]) => {
                      const p = getStonePalette(stone, palettes);
                      const cft = list.reduce((s, b) => s + volumeOf(b), 0);
                      return (
                        <div key={stone}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.top, border: `1.5px solid ${p.front}`, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 800 }}>{stoneDisplayName(stone)}</span>
                            <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              {list.length} · {cft.toFixed(0)} CFT
                            </span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-end" }}>
                            {list.map((b) => {
                              const vol = volumeOf(b);
                              const side = sideOf(vol);
                              const isPicked = picked?.id === b.id;
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => setPicked(isPicked ? null : b)}
                                  title={`${b.id} · ${b.stone} · ${vol.toFixed(1)} CFT${b.quality ? ` · ${b.quality}` : ""} · ${blockStatusLabel(b.status)}`}
                                  style={{
                                    width: side,
                                    height: Math.round(side * 0.72),
                                    borderRadius: 4,
                                    background: `linear-gradient(180deg, ${p.top} 0%, ${p.top} 42%, ${p.front} 100%)`,
                                    border: `1.5px solid ${isPicked ? "var(--text)" : p.front}`,
                                    boxShadow: isPicked ? "0 0 0 2.5px var(--gold)" : "0 1px 3px rgba(45,36,16,0.18)",
                                    cursor: "pointer",
                                    padding: 0,
                                    flexShrink: 0,
                                    ...statusStyle(b.status),
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right arrow */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px 0 6px" }}>
          <button
            type="button"
            className="yc-arrow"
            onClick={() => go(1)}
            disabled={idx === FACILITIES.length - 1}
            aria-label="Next site"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 17,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(45,36,16,0.08)",
            }}
          >
            →
          </button>
        </div>
      </div>

      {/* ── Picked-block detail strip ── */}
      {picked && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--surface)",
            padding: "12px 22px",
            display: "flex",
            gap: 18,
            alignItems: "baseline",
            flexWrap: "wrap",
            fontSize: 13,
            boxShadow: "0 -6px 18px rgba(45,36,16,0.06)",
          }}
        >
          <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "var(--gold-dark)" }}>{picked.id}</strong>
          <span style={{ fontWeight: 700 }}>{picked.stone}</span>
          <span>{yardLabel(picked.yard)}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {stoneCategoryMap[picked.stone] === "marble"
              ? `${Number(picked.tonnes ?? 0)} T (≈${volumeOf(picked).toFixed(1)} CFT)`
              : `${picked.length_ft ?? "—"} × ${picked.width_ft ?? "—"} × ${picked.height_ft ?? "—"} in · ${volumeOf(picked).toFixed(2)} CFT`}
          </span>
          {picked.quality && <span>Grade {picked.quality}</span>}
          <span>{blockStatusLabel(picked.status)}</span>
          {picked.vendor_name && <span style={{ color: "var(--muted)" }}>{picked.vendor_name}</span>}
          <button
            type="button"
            onClick={() => setPicked(null)}
            style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
