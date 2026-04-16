"use client";

import { useState, useMemo } from "react";

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
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function stoneLabel(stone: string | null) {
  if (!stone) return "—";
  return stone.replace(/Stone$/i, "") || stone;
}

function calcCft(l: number, w: number, t: number) {
  return (Number(l) * Number(w) * Number(t)) / 1728;
}

type SortCol = "id" | "temple" | "stone" | "cft" | "created_at" | "updated_at";

export function ReadySlabsClient({ slabs, stoneNames, templeNames }: {
  slabs: Slab[];
  stoneNames?: string[];
  templeNames?: string[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const ALL_STONES = stoneNames && stoneNames.length > 0 ? stoneNames : ["PinkStone", "WhiteStone"];
  const ALL_TEMPLES = templeNames ?? [];

  const [stoneFilter, setStoneFilter] = useState("all");
  const [templeFilter, setTempleFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortCol>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    let rows = [...slabs];
    if (stoneFilter !== "all") rows = rows.filter(s => s.stone === stoneFilter);
    if (templeFilter !== "all") rows = rows.filter(s => s.temple === templeFilter);
    if (qualityFilter === "A") rows = rows.filter(s => s.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter(s => s.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter(s => !s.quality);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.temple.toLowerCase().includes(q) ||
        (s.stone ?? "").toLowerCase().includes(q)
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
  }, [slabs, stoneFilter, templeFilter, qualityFilter, search, dateFrom, dateTo, sortBy, sortDir]);

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>

          {/* Stone */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Stone</span>
            <select value={stoneFilter} onChange={e => setStoneFilter(e.target.value)}>
              <option value="all">All Stones</option>
              {ALL_STONES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          {/* Temple */}
          <label className="stack" style={{ flex: "1 1 160px" }}>
            <span>Temple</span>
            <select value={templeFilter} onChange={e => setTempleFilter(e.target.value)}>
              <option value="all">All Temples</option>
              {ALL_TEMPLES.map(t => <option key={t} value={t}>{t}</option>)}
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
              placeholder="Code, label, temple, stone…"
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

        {/* Quick presets */}
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Quick:</span>
          {[
            { label: "Last 7 days",  fn: () => { setDateFrom(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
            { label: "Last 30 days", fn: () => { setDateFrom(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
            { label: "Last 90 days", fn: () => { setDateFrom(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)); setDateTo(today); } },
          ].map(p => (
            <button key={p.label} type="button" className="ghost-button" style={{ fontSize: 11, padding: "2px 9px" }} onClick={p.fn}>
              {p.label}
            </button>
          ))}
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
                { label: "Temple",       col: "temple" as SortCol },
                { label: "Label",        col: null },
                { label: "Stone",        col: "stone" as SortCol },
                { label: "Quality",      col: null },
                { label: "Dimensions",   col: null },
                { label: "CFT",          col: "cft" as SortCol },
                { label: "Priority",     col: null },
                { label: "Added",        col: "created_at" as SortCol },
                { label: "Cut Done",     col: "updated_at" as SortCol },
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
                <td colSpan={10} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Columns: Size Code · Temple · Label · Stone · Quality · Dimensions · CFT · Priority · Added · Cut Done
      </p>
    </div>
  );
}
