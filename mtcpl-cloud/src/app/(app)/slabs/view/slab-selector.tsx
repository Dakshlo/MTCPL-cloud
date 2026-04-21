"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

type Slab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
  priority_note: string | null;
  quality: string | null;
  created_at: string | null;
};

type ActiveFilters = { temple?: string; stone?: string; priority?: string; status?: string; q?: string; quality?: string };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function stoneLabel(stone: string | null) {
  if (!stone) return "—";
  return stone.replace(/Stone$/i, "") || stone;
}

type SortCol = "id" | "temple" | "stone" | "cft" | "status" | "created_at";

export function SlabSelector({
  slabs,
  temples,
  activeFilters,
  stoneNames,
}: {
  slabs: Slab[];
  temples: string[];
  activeFilters: ActiveFilters;
  stoneNames?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(activeFilters.q ?? "");
  const [stoneFilter, setStoneFilter] = useState(activeFilters.stone ?? "all");
  const [templeFilter, setTempleFilter] = useState(activeFilters.temple ?? "all");
  const [qualityFilter, setQualityFilter] = useState(activeFilters.quality ?? "all");
  const [priorityFilter, setPriorityFilter] = useState(activeFilters.priority ?? "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortCol>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const ALL_STONES = stoneNames && stoneNames.length > 0 ? stoneNames : ["PinkStone", "WhiteStone"];

  // Split priority slabs out — pinned at the top of whatever status
  // view the user is currently on. The server-side urgent fetcher
  // (page.tsx) restricts urgent slabs to the active status filter, so
  // the pinned bucket is automatically scoped correctly:
  //   • Open tab    → pinned = urgent-open
  //   • Planned tab → pinned = urgent-planned
  //   • Both tab    → pinned = urgent-open + urgent-planned
  const allPriority = useMemo(() => slabs.filter(s => s.priority), [slabs]);
  const allNormal   = useMemo(() => slabs.filter(s => !s.priority), [slabs]);

  // Priority section: only search can narrow it (stone/temple/quality/priority filters don't hide these)
  const filteredPriority = useMemo(() => {
    if (!q.trim()) return allPriority;
    const lower = q.toLowerCase();
    return allPriority.filter(s =>
      s.id.toLowerCase().includes(lower) ||
      s.label.toLowerCase().includes(lower) ||
      s.temple.toLowerCase().includes(lower)
    );
  }, [allPriority, q]);

  // Normal section: filtered by everything
  const filtered = useMemo(() => {
    let rows = [...allNormal];

    if (q.trim()) {
      const lower = q.toLowerCase();
      rows = rows.filter(s =>
        s.id.toLowerCase().includes(lower) ||
        s.label.toLowerCase().includes(lower) ||
        s.temple.toLowerCase().includes(lower)
      );
    }
    if (stoneFilter !== "all") rows = rows.filter(s => s.stone === stoneFilter);
    if (templeFilter !== "all") rows = rows.filter(s => s.temple === templeFilter);
    if (qualityFilter === "A") rows = rows.filter(s => s.quality === "A");
    else if (qualityFilter === "B") rows = rows.filter(s => s.quality === "B");
    else if (qualityFilter === "none") rows = rows.filter(s => !s.quality);
    // priorityFilter "true" → already handled above; "false" → normal rows only (already split)

    rows.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortBy === "cft") {
        av = Number(a.length_ft) * Number(a.width_ft) * Number(a.thickness_ft);
        bv = Number(b.length_ft) * Number(b.width_ft) * Number(b.thickness_ft);
      } else {
        av = String((a as Record<string, unknown>)[sortBy] ?? "");
        bv = String((b as Record<string, unknown>)[sortBy] ?? "");
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [allNormal, q, stoneFilter, templeFilter, qualityFilter, sortBy, sortDir]);

  // Status filter still goes via URL (server re-fetch)
  function setStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("status", value);
    else params.delete("status");
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortBy !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
    return <span style={{ color: "var(--gold)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisible = useMemo(() => [...filteredPriority, ...filtered], [filteredPriority, filtered]);

  function toggleAll() {
    if (selected.size === allVisible.length && allVisible.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allVisible.map(s => s.id)));
    }
  }

  function sendToPlanning() {
    if (selected.size === 0) return;
    router.push(`/planning?slabs=${[...selected].join(",")}`);
  }

  function clearFilters() {
    setQ("");
    setStoneFilter("all");
    setTempleFilter("all");
    setQualityFilter("all");
    setPriorityFilter("all");
  }

  const allChecked = allVisible.length > 0 && selected.size === allVisible.length;
  const someChecked = selected.size > 0 && selected.size < allVisible.length;
  const currentStatus = activeFilters.status ?? "open";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Plan Generator</h1>
          <p className="muted">
            Select sizes to send to the Plan Generator.{" "}
            {filteredPriority.length > 0 && <><strong style={{ color: "#DC2626" }}>⚡ {filteredPriority.length} urgent</strong> · </>}
            <strong>{filtered.length}</strong> normal shown
            {selected.size > 0 && <> · <strong style={{ color: "var(--gold-dark)" }}>{selected.size} selected</strong></>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/slabs" className="secondary-button">← Required Sizes</Link>
          <button
            className="primary-button"
            onClick={sendToPlanning}
            disabled={selected.size === 0}
          >
            Send {selected.size > 0 ? selected.size : ""} to Plan Generator →
          </button>
        </div>
      </div>

      {/* Filter Panel */}
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
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { value: "open", label: "Open" },
                { value: "planned", label: "Planned" },
                { value: "all", label: "Both" },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  style={{
                    fontSize: 12,
                    padding: "4px 11px",
                    borderRadius: 20,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontWeight: currentStatus === opt.value ? 700 : 400,
                    background: currentStatus === opt.value ? "var(--gold)" : "transparent",
                    color: currentStatus === opt.value ? "#fff" : "var(--text)",
                    transition: "background 0.15s",
                  }}
                >
                  {opt.label}
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

          {/* Temple */}
          <label className="stack" style={{ flex: "1 1 160px" }}>
            <span>Temple</span>
            <select value={templeFilter} onChange={e => setTempleFilter(e.target.value)}>
              <option value="all">All Temples</option>
              {temples.map(t => <option key={t} value={t}>{t}</option>)}
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

          {/* Priority */}
          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>Priority</span>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="true">⚡ Urgent only</option>
              <option value="false">Normal only</option>
            </select>
          </label>

          {/* Search */}
          <label className="stack" style={{ flex: "1 1 160px" }}>
            <span>Search</span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Code, label, temple…"
            />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button type="button" className="ghost-button" onClick={clearFilters}>Clear All</button>
          </div>
        </div>

        {/* Quick actions */}
        {allPriority.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>Quick:</span>
            <button
              type="button"
              className="ghost-button"
              style={{ fontSize: 11, padding: "2px 9px", color: "#DC2626", borderColor: "rgba(220,38,38,0.3)" }}
              onClick={() => {
                setSelected(prev => {
                  const next = new Set(prev);
                  allPriority.forEach(s => next.add(s.id));
                  return next;
                });
              }}
            >
              ⚡ Select all {allPriority.length} urgent
            </button>
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <p className="muted" style={{ fontSize: 13 }}>
          {filteredPriority.length > 0 && <><strong style={{ color: "#DC2626" }}>⚡ {filteredPriority.length} urgent</strong> · </>}
          <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> normal · {allVisible.length} total shown
          {selected.size > 0 && <> · <strong style={{ color: "var(--gold-dark)" }}>{selected.size} selected</strong></>}
        </p>
        {selected.size > 0 && (
          <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)", borderBottom: "2px solid var(--border)" }}>
              <th style={{ padding: "10px 12px", width: 36 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }}
                />
              </th>
              {([
                { label: "Size Code",  col: "id" as SortCol },
                { label: "Temple",     col: "temple" as SortCol },
                { label: "Label",      col: null },
                { label: "Stone",      col: "stone" as SortCol },
                { label: "Quality",    col: null },
                { label: "Dimensions", col: null },
                { label: "CFT",        col: "cft" as SortCol },
                { label: "Status",     col: "status" as SortCol },
                { label: "Added",      col: "created_at" as SortCol },
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
            {/* ── PRIORITY SECTION — always visible, never filtered away ── */}
            {filteredPriority.length > 0 && (
              <>
                <tr>
                  <td colSpan={10} style={{
                    padding: "7px 14px",
                    background: "rgba(220,38,38,0.07)",
                    borderBottom: "1px solid rgba(220,38,38,0.2)",
                    borderTop: "1px solid rgba(220,38,38,0.2)",
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      ⚡ Urgent / Pushed — {filteredPriority.length} {filteredPriority.length === 1 ? "size" : "sizes"} · Always shown regardless of filters
                    </span>
                  </td>
                </tr>
                {filteredPriority.map((s, i) => {
                  const cft = ((Number(s.length_ft) * Number(s.width_ft) * Number(s.thickness_ft)) / 1728).toFixed(2);
                  const isChecked = selected.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => toggleOne(s.id)}
                      style={{
                        borderBottom: "1px solid rgba(220,38,38,0.12)",
                        background: isChecked ? "rgba(184,115,51,0.12)" : i % 2 === 0 ? "rgba(220,38,38,0.04)" : "rgba(220,38,38,0.07)",
                        cursor: "pointer",
                        outline: isChecked ? "1.5px solid rgba(184,115,51,0.35)" : "none",
                        outlineOffset: -1,
                      }}
                    >
                      <td style={{ padding: "9px 12px" }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleOne(s.id)} style={{ cursor: "pointer" }} />
                      </td>
                      <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 700, whiteSpace: "nowrap", color: "#DC2626" }}>
                        {s.id} <span style={{ fontSize: 12 }}>⚡</span>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.temple}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)" }}>{s.label}</td>
                      <td style={{ padding: "9px 12px" }}>
                        {s.stone ? <span className={`role-pill ${s.stone === "PinkStone" ? "badge-pink" : s.stone === "WhiteStone" ? "badge-white-stone" : "badge-open"}`}>{stoneLabel(s.stone)}</span> : <span className="muted">—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {s.quality ? <span className={`role-pill ${s.quality === "A" ? "badge-available" : "badge-reserved"}`}>Grade {s.quality}</span> : <span className="muted">—</span>}
                      </td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {Number(s.length_ft)}" × {Number(s.width_ft)}" × {Number(s.thickness_ft)}"
                      </td>
                      <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{cft}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span className={`role-pill ${s.status === "open" ? "badge-open" : "badge-planned"}`}>{s.status}</span>
                      </td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.created_at)}</td>
                    </tr>
                  );
                })}
              </>
            )}

            {/* ── NORMAL SECTION — filtered by all controls ── */}
            {filteredPriority.length > 0 && filtered.length > 0 && (
              <tr>
                <td colSpan={10} style={{
                  padding: "7px 14px",
                  background: "var(--surface-alt)",
                  borderBottom: "1px solid var(--border)",
                  borderTop: "2px solid var(--border)",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Normal — {filtered.length} {filtered.length === 1 ? "size" : "sizes"}
                  </span>
                </td>
              </tr>
            )}

            {filtered.length === 0 && filteredPriority.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                  No sizes match your filters.
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                  No normal sizes match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => {
                const cft = ((Number(s.length_ft) * Number(s.width_ft) * Number(s.thickness_ft)) / 1728).toFixed(2);
                const isChecked = selected.has(s.id);
                return (
                  <tr
                    key={s.id}
                    onClick={() => toggleOne(s.id)}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isChecked ? "rgba(184,115,51,0.10)" : i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)",
                      cursor: "pointer",
                      outline: isChecked ? "1.5px solid rgba(184,115,51,0.35)" : "none",
                      outlineOffset: -1,
                      transition: "background 0.1s",
                    }}
                  >
                    <td style={{ padding: "9px 12px" }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(s.id)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{s.id}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.temple}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)" }}>{s.label}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {s.stone ? <span className={`role-pill ${s.stone === "PinkStone" ? "badge-pink" : s.stone === "WhiteStone" ? "badge-white-stone" : "badge-open"}`}>{stoneLabel(s.stone)}</span> : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {s.quality ? <span className={`role-pill ${s.quality === "A" ? "badge-available" : "badge-reserved"}`}>Grade {s.quality}</span> : <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                      {Number(s.length_ft)}" × {Number(s.width_ft)}" × {Number(s.thickness_ft)}"
                    </td>
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{cft}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span className={`role-pill ${s.status === "open" ? "badge-open" : "badge-planned"}`}>{s.status}</span>
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.created_at)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sticky Send Button */}
      {selected.size > 0 && (
        <div className="slab-send-sticky">
          <div className="slab-send-sticky-inner">
            <span><strong>{selected.size}</strong> sizes selected</span>
            <button className="primary-button" onClick={sendToPlanning}>
              Send to Plan Generator →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
