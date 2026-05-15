"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ALLOWED_YARDS, yardLabel, yardShortLabel } from "@/lib/yards";
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

const ALL_STATUSES = ["available", "reserved", "consumed", "discarded"] as const;

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

// Filter-button labels — intentionally status-only so the filter chips match
// the raw status you can set on a block. The table cell uses blockStatusLabel
// which adds Fresh vs Used based on category.
const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  reserved: "In Progress",
  consumed: "Consumed",
  discarded: "Deleted",
};

type SortCol = "id" | "stone" | "yard" | "cft" | "status" | "vendor_name" | "created_at" | "updated_at";

export function ReportClient({
  blocks,
  stoneNames,
  stoneCategoryMap = {},
}: {
  blocks: Block[];
  stoneNames?: string[];
  stoneCategoryMap?: Record<string, StoneCategory>;
}) {
  const ALL_STONES = stoneNames && stoneNames.length > 0 ? stoneNames : ["PinkStone", "WhiteStone"];
  const today = new Date().toISOString().slice(0, 10);

  // Filters. Default = only 'available' — when the report loads, people need
  // to see what's actually in the yard right now, not historical totals that
  // get confusing ("why is our stock so huge?"). Other filters are additive.
  const [statusFilter, setStatusFilter] = useState<string[]>(["available"]);
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

  const filtered = useMemo(() => {
    let rows = [...blocks];

    if (statusFilter.length > 0) rows = rows.filter(b => statusFilter.includes(b.status));
    if (stoneFilter !== "all") rows = rows.filter(b => b.stone === stoneFilter);
    if (yardFilter !== "all") rows = rows.filter(b => String(b.yard) === yardFilter);
    if (qualityFilter === "A") rows = rows.filter(b => b.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter(b => b.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter(b => !b.quality);
    if (vendorSearch) rows = rows.filter(b => b.vendor_name?.toLowerCase().includes(vendorSearch.toLowerCase()));
    if (blockSearch) rows = rows.filter(b => b.id.toLowerCase().includes(blockSearch.toLowerCase()));
    if (dateFrom) rows = rows.filter(b => b.created_at && b.created_at >= dateFrom);
    if (dateTo) rows = rows.filter(b => b.created_at && b.created_at <= dateTo + "T23:59:59Z");

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
  }, [blocks, statusFilter, stoneFilter, yardFilter, qualityFilter, vendorSearch, blockSearch, dateFrom, dateTo, sortBy, sortDir]);

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
      {/* ── Filter Panel ── */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 18px",
        marginBottom: 14,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>

          {/* Status toggles */}
          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Status</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ALL_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  style={{
                    fontSize: 12,
                    padding: "4px 11px",
                    borderRadius: 20,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontWeight: statusFilter.includes(s) ? 700 : 400,
                    background: statusFilter.includes(s) ? "var(--gold)" : "transparent",
                    color: statusFilter.includes(s) ? "#fff" : "var(--text)",
                    transition: "background 0.15s",
                  }}
                >
                  {STATUS_LABELS[s] ?? s}
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
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Quick:</span>
          {[
            { label: "Available only", fn: () => setStatusFilter(["available"]) },
            { label: "Active (available + in progress)", fn: () => setStatusFilter(["available", "reserved"]) },
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
        <button className="primary-button" type="button" onClick={handleExport} disabled={exporting} style={{ gap: 6 }}>
          {exporting ? "Exporting…" : "⬇ Export to Excel"}
        </button>
      </div>

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
