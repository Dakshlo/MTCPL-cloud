"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

type Slab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  quality: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** Block this slab was cut from. Set by finish_block_cut RPC at
   *  approval time. Older / manually-entered slabs may be NULL. */
  source_block_id?: string | null;
};

/** Display chip for the slab's post-cut lifecycle position. */
const STATUS_TINT: Record<string, { label: string; bg: string; fg: string }> = {
  cut_done:             { label: "Cut · awaiting carving", bg: "rgba(34,197,94,0.14)",  fg: "#15803d" },
  carving_assigned:     { label: "Carving assigned",        bg: "rgba(245,158,11,0.16)", fg: "#92400e" },
  carving_in_progress:  { label: "Being carved",            bg: "rgba(59,130,246,0.14)", fg: "#1e40af" },
  completed:            { label: "Carving done",            bg: "rgba(16,185,129,0.16)", fg: "#0f766e" },
  dispatched:           { label: "Dispatched",              bg: "rgba(148,163,184,0.18)", fg: "#475569" },
  // Broken-during-carving terminal status. Still kept visible so the
  // cutting team can audit "which slabs from MT-B-246 are alive vs
  // destroyed" — the source block stays credited for cutting them.
  rejected:             { label: "Broken / rejected",        bg: "rgba(220,38,38,0.14)",  fg: "#991b1b" },
};

function StatusChip({ status }: { status: string }) {
  const t = STATUS_TINT[status] ?? { label: status, bg: "rgba(0,0,0,0.06)", fg: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {t.label}
    </span>
  );
}

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

function stoneLabel(stone: string | null) {
  if (!stone) return "—";
  return stone.replace(/Stone$/i, "") || stone;
}

function calcCft(l: number, w: number, t: number) {
  return (Number(l) * Number(w) * Number(t)) / 1728;
}

type SortCol = "id" | "temple" | "stone" | "cft" | "created_at" | "updated_at";

export function ReadySlabsClient({
  slabs,
  stoneNames: _stoneNames,
  templeNames: _templeNames,
  mode = "verification",
}: {
  slabs: Slab[];
  /** @deprecated derived from slabs directly */
  stoneNames?: string[];
  /** @deprecated derived from slabs directly */
  templeNames?: string[];
  /** "verification" — show every post-cut status with a Status column +
   *      status-filter chip row. Used on /slabs/ready by the cutting team.
   *  "for-carving" — only cut_done slabs (server-side); status column is
   *      hidden, action column shows "Assign →" routing to /carving.
   *      Used on /slabs/ready/for-carving by the carving team. */
  mode?: "verification" | "for-carving";
}) {
  void _stoneNames;
  void _templeNames;
  const today = new Date().toISOString().slice(0, 10);

  const [stoneFilter, setStoneFilter] = useState("all");
  const [templeFilter, setTempleFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  // for-carving mode lands the carving team on the "Cut · awaiting
  // carving" bucket so they see what's pickable first. Total Ready
  // Sizes (verification mode) doesn't show the chip row at all, so
  // its statusFilter is irrelevant; we default it to "all" for
  // sanity.
  const [statusFilter, setStatusFilter] = useState<string>(
    mode === "for-carving" ? "cut_done" : "all",
  );
  const [search, setSearch] = useState("");
  // Default to NO date filter — page lands showing every cut slab so
  // the cutting team can scroll back as far as they need. The quick
  // preset buttons (Today / Yesterday / Last 3 / 7 / 30 / 90) and the
  // manual date inputs let them narrow when they want a smaller
  // window. (Earlier default was "today only" which hid 99% of the
  // history on first load — Daksh asked to drop it.)
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortCol>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [exporting, setExporting] = useState(false);

  // ── Cascading filter options ──────────────────────────────────────────
  // Each dropdown's option list is derived from the slabs that pass
  // ALL OTHER active filters. Selecting Stone=PinkStone narrows the
  // Temple dropdown to only temples where PinkStone slabs exist.
  // (See slab-selector.tsx for the same pattern + why.)
  const availableStones = useMemo(() => {
    let rows = slabs;
    if (templeFilter !== "all") rows = rows.filter((s) => s.temple === templeFilter);
    if (qualityFilter === "A") rows = rows.filter((s) => s.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter((s) => s.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter((s) => !s.quality);
    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((s) =>
        s.id.toLowerCase().includes(lower) ||
        s.label.toLowerCase().includes(lower) ||
        s.temple.toLowerCase().includes(lower) ||
        (s.stone ?? "").toLowerCase().includes(lower) ||
        (s.source_block_id ?? "").toLowerCase().includes(lower),
      );
    }
    const set = new Set<string>();
    for (const s of rows) if (s.stone) set.add(s.stone);
    return [...set].sort();
  }, [slabs, templeFilter, qualityFilter, search]);

  const availableTemples = useMemo(() => {
    let rows = slabs;
    if (stoneFilter !== "all") rows = rows.filter((s) => s.stone === stoneFilter);
    if (qualityFilter === "A") rows = rows.filter((s) => s.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter((s) => s.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter((s) => !s.quality);
    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((s) =>
        s.id.toLowerCase().includes(lower) ||
        s.label.toLowerCase().includes(lower) ||
        s.temple.toLowerCase().includes(lower) ||
        (s.stone ?? "").toLowerCase().includes(lower) ||
        (s.source_block_id ?? "").toLowerCase().includes(lower),
      );
    }
    const set = new Set<string>();
    for (const s of rows) if (s.temple) set.add(s.temple);
    return [...set].sort();
  }, [slabs, stoneFilter, qualityFilter, search]);

  // Auto-reset orphaned selections: if user picked Stone=X then
  // narrowed by Temple=Y where Y has no X, clear the orphan to "all".
  useEffect(() => {
    if (stoneFilter !== "all" && availableStones.length > 0 && !availableStones.includes(stoneFilter)) {
      setStoneFilter("all");
    }
  }, [availableStones, stoneFilter]);
  useEffect(() => {
    if (templeFilter !== "all" && availableTemples.length > 0 && !availableTemples.includes(templeFilter)) {
      setTempleFilter("all");
    }
  }, [availableTemples, templeFilter]);

  const filtered = useMemo(() => {
    let rows = [...slabs];
    if (stoneFilter !== "all") rows = rows.filter(s => s.stone === stoneFilter);
    if (templeFilter !== "all") rows = rows.filter(s => s.temple === templeFilter);
    if (qualityFilter === "A") rows = rows.filter(s => s.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter(s => s.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter(s => !s.quality);
    // statusFilter applies on the page that owns the chip row. With
    // the move from verification → for-carving, that's the carving
    // team's page now. The verification page intentionally has no
    // chip row so statusFilter stays "all" and this is a no-op.
    if (mode === "for-carving" && statusFilter !== "all") {
      rows = rows.filter((s) => s.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.temple.toLowerCase().includes(q) ||
        (s.stone ?? "").toLowerCase().includes(q) ||
        (s.source_block_id ?? "").toLowerCase().includes(q)
      );
    }
    if (dateFrom) rows = rows.filter(s => s.updated_at && s.updated_at >= dateFrom);
    if (dateTo) rows = rows.filter(s => s.updated_at && s.updated_at <= dateTo + "T23:59:59Z");

    rows.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortBy === "cft") {
        av = calcCft(a.length_ft, a.width_ft, a.thickness_ft);
        bv = calcCft(b.length_ft, b.width_ft, b.thickness_ft);
      } else {
        av = String((a as Record<string, unknown>)[sortBy] ?? "");
        bv = String((b as Record<string, unknown>)[sortBy] ?? "");
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [slabs, stoneFilter, templeFilter, qualityFilter, statusFilter, mode, search, dateFrom, dateTo, sortBy, sortDir]);

  const totalCft = filtered.reduce((sum, s) => sum + calcCft(s.length_ft, s.width_ft, s.thickness_ft), 0);

  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortBy !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
    return <span style={{ color: "var(--gold)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function clearAll() {
    setStoneFilter("all");
    setTempleFilter("all");
    setQualityFilter("all");
    setStatusFilter("all");
    setSearch("");
    setDateFrom("");
    setDateTo("");
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (stoneFilter !== "all") params.set("stone", stoneFilter);
      if (templeFilter !== "all") params.set("temple", templeFilter);
      if (qualityFilter !== "all") params.set("quality", qualityFilter);
      if (search) params.set("search", search);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);

      const res = await fetch(`/api/slabs/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const label = dateFrom && dateTo ? `${dateFrom}-to-${dateTo}` : "all";
      link.download = `ready-sizes-${label}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // Status counts (verification mode only) — chip row at the top of
  // the filter panel that doubles as a quick "where are these slabs
  // now?" snapshot for the cutting team.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of slabs) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [slabs]);
  const orderedStatusKeys = [
    "cut_done",
    "carving_assigned",
    "carving_in_progress",
    "completed",
    "dispatched",
    "rejected",
  ];

  return (
    <div>
      {/* Filter Panel */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 18px",
        marginBottom: 14,
      }}>
        {/* Lifecycle chip row — for-carving mode owns this now (was
            on verification originally). Total Ready Sizes is a flat
            "every slab ever cut" view without buckets; Ready Sizes
            Stock leads with the chip row so the carving team can
            flip between buckets at a glance. */}
        {mode === "for-carving" && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: "1px dashed var(--border)",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
              Lifecycle
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${statusFilter === "all" ? "var(--gold-dark)" : "var(--border)"}`,
                background: statusFilter === "all" ? "rgba(180,115,51,0.10)" : "var(--bg)",
                color: statusFilter === "all" ? "var(--gold-dark)" : "var(--muted)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              All ({slabs.length})
            </button>
            {orderedStatusKeys.map((k) => {
              const t = STATUS_TINT[k];
              const count = statusCounts[k] ?? 0;
              const isActive = statusFilter === k;
              if (count === 0) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(k)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: `1px solid ${isActive ? t.fg : "var(--border)"}`,
                    background: isActive ? t.bg : "var(--bg)",
                    color: isActive ? t.fg : "var(--muted)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>

          {/* Stone — cascades from temple+quality+search */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Stone <span style={{ fontSize: 9, color: "var(--muted)" }}>({availableStones.length})</span></span>
            <select value={stoneFilter} onChange={e => setStoneFilter(e.target.value)}>
              <option value="all">All Stones</option>
              {availableStones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          {/* Temple — cascades from stone+quality+search */}
          <label className="stack" style={{ flex: "1 1 160px" }}>
            <span>Temple <span style={{ fontSize: 9, color: "var(--muted)" }}>({availableTemples.length})</span></span>
            <select value={templeFilter} onChange={e => setTempleFilter(e.target.value)}>
              <option value="all">All Temples</option>
              {availableTemples.map(t => <option key={t} value={t}>{t}</option>)}
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

          {/* Search */}
          <label className="stack" style={{ flex: "1 1 160px" }}>
            <span>Search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Code, label, temple, stone, block…"
            />
          </label>

          {/* Date range (cut done date) */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Cut From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 140 }} />
          </label>
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Cut To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 140 }} />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button type="button" className="ghost-button" onClick={clearAll}>Clear All</button>
          </div>
        </div>

        {/* Quick presets — page now defaults to Today so these are
            shortcuts to widen the window. Active button is highlighted
            so the user can see which range they're currently on. */}
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Quick:</span>
          {(() => {
            const yesterday = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
            const last3 = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
            const last7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
            const last30 = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
            const last90 = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);
            const presets: Array<{ label: string; from: string; to: string }> = [
              { label: "Today",        from: today,     to: today },
              { label: "Yesterday",    from: yesterday, to: yesterday },
              { label: "Last 3 days",  from: last3,     to: today },
              { label: "Last 7 days",  from: last7,     to: today },
              { label: "Last 30 days", from: last30,    to: today },
              { label: "Last 90 days", from: last90,    to: today },
            ];
            return presets.map((p) => {
              const isActive = dateFrom === p.from && dateTo === p.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  className="ghost-button"
                  style={{
                    fontSize: 11,
                    padding: "2px 9px",
                    background: isActive ? "rgba(180,115,51,0.12)" : undefined,
                    borderColor: isActive ? "var(--gold-dark)" : undefined,
                    color: isActive ? "var(--gold-dark)" : undefined,
                    fontWeight: isActive ? 700 : undefined,
                  }}
                  onClick={() => {
                    setDateFrom(p.from);
                    setDateTo(p.to);
                  }}
                >
                  {p.label}
                </button>
              );
            });
          })()}
        </div>
      </div>

      {/* Summary + Export */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <p className="muted" style={{ fontSize: 13 }}>
          Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {slabs.length} ready sizes ·{" "}
          Total <strong style={{ color: "var(--text)" }}>{totalCft.toFixed(2)} CFT</strong>
        </p>
        <button className="primary-button" type="button" onClick={handleExport} disabled={exporting} style={{ gap: 6 }}>
          {exporting ? "Exporting…" : "⬇ Export to Excel"}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)", borderBottom: "2px solid var(--border)" }}>
              {([
                { label: "Size Code",    col: "id" as SortCol },
                { label: "From Block",   col: null },
                { label: "Temple",       col: "temple" as SortCol },
                { label: "Label",        col: null },
                { label: "Stone",        col: "stone" as SortCol },
                { label: "Quality",      col: null },
                { label: "Dimensions",   col: null },
                { label: "CFT",          col: "cft" as SortCol },
                { label: "Priority",     col: null },
                { label: "Added",        col: "created_at" as SortCol },
                { label: "Cut Done",     col: "updated_at" as SortCol },
                // Status column on the for-carving page (where the
                // chip row + multi-status query make it meaningful).
                // Verification ("Total Ready Sizes") is a flat list
                // without status badges — keep it simple.
                ...(mode === "for-carving"
                  ? ([
                      { label: "Status", col: null },
                      { label: "", col: null },
                    ] as { label: string; col: SortCol | null }[])
                  : ([] as { label: string; col: SortCol | null }[])),
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
                <td colSpan={mode === "for-carving" ? 13 : 11} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                  {slabs.length === 0 ? "No sizes have been cut yet." : "No sizes match the current filters."}
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => {
                const cft = calcCft(s.length_ft, s.width_ft, s.thickness_ft);
                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)",
                    }}
                  >
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {s.id}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontSize: 12 }}>
                      {s.source_block_id ? (
                        <Link
                          href={`/block-journey?focus=${encodeURIComponent(s.source_block_id)}`}
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 600,
                            color: "var(--gold-dark)",
                            textDecoration: "none",
                          }}
                          title={`Open block journey for ${s.source_block_id}`}
                        >
                          {s.source_block_id}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontSize: 12 }}>{s.temple}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)" }}>{s.label}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {s.stone ? (
                        <span className={`role-pill ${s.stone === "PinkStone" ? "badge-pink" : s.stone === "WhiteStone" ? "badge-white-stone" : "badge-open"}`}>
                          {stoneLabel(s.stone)}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {s.quality ? (
                        <span className={`role-pill ${s.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                          Grade {s.quality}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                      {Number(s.length_ft)}" × {Number(s.width_ft)}" × {Number(s.thickness_ft)}"
                    </td>
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{cft.toFixed(2)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      {s.priority ? <span style={{ fontSize: 14 }}>⚡</span> : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.created_at)}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.updated_at)}</td>
                    {mode === "for-carving" && (
                      <>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                          <StatusChip status={s.status} />
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                          {s.status === "cut_done" ? (
                            <Link
                              href="/carving"
                              style={{
                                textDecoration: "none",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "4px 10px",
                                background: "var(--gold)",
                                color: "#fff",
                                border: "1px solid var(--gold-dark)",
                                borderRadius: 6,
                              }}
                              title="Open the Carving Jobs page to assign this slab to a vendor"
                            >
                              Assign →
                            </Link>
                          ) : (
                            <span className="muted" style={{ fontSize: 11 }}>—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Columns: Size Code · From Block · Temple · Label · Stone · Quality · Dimensions · CFT · Priority · Added · Cut Done
        {mode === "for-carving" ? " · Status · Assign" : ""}
      </p>
    </div>
  );
}
