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
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return slabs.filter(s => {
      if (q.trim()) {
        const lower = q.toLowerCase();
        if (!s.id.toLowerCase().includes(lower) && !s.label.toLowerCase().includes(lower) && !s.temple.toLowerCase().includes(lower)) return false;
      }
      if (activeFilters.quality === "A" && s.quality !== "A") return false;
      if (activeFilters.quality === "B" && s.quality !== "B") return false;
      if (activeFilters.quality === "none" && s.quality !== null && s.quality !== "") return false;
      return true;
    });
  }, [slabs, q, activeFilters.quality]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slab[]>();
    for (const s of filtered) {
      const group = map.get(s.temple) ?? [];
      group.push(s);
      map.set(s.temple, group);
    }
    return map;
  }, [filtered]);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.id)));
    }
  }

  function sendToPlanning() {
    if (selected.size === 0) return;
    const ids = [...selected].join(",");
    router.push(`/planning?slabs=${ids}`);
  }

  const priorityCount = filtered.filter(s => s.priority).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Slab Inventory</h1>
          <p className="muted">
            Select slabs to send to the Plan Generator.{" "}
            <strong>{filtered.length}</strong> slabs shown
            {selected.size > 0 && <> · <strong style={{ color: "var(--gold-dark)" }}>{selected.size} selected</strong></>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/slabs" className="secondary-button">← Slab Entry</Link>
          <button
            className="primary-button"
            onClick={sendToPlanning}
            disabled={selected.size === 0}
          >
            Send {selected.size > 0 ? selected.size : ""} to Plan Generator →
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          className="filter-search"
          type="search"
          placeholder="Search by code, label, temple…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />

        <select
          className="filter-select"
          value={activeFilters.temple ?? ""}
          onChange={e => setFilter("temple", e.target.value)}
        >
          <option value="">All Temples</option>
          {temples.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          className="filter-select"
          value={activeFilters.stone ?? ""}
          onChange={e => setFilter("stone", e.target.value)}
        >
          <option value="">All Stones</option>
          {(stoneNames && stoneNames.length > 0
            ? stoneNames
            : ["PinkStone", "WhiteStone"]
          ).map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select
          className="filter-select"
          value={activeFilters.quality ?? ""}
          onChange={e => setFilter("quality", e.target.value)}
        >
          <option value="">All Quality</option>
          <option value="A">Grade A only</option>
          <option value="B">Grade B only</option>
          <option value="none">Unspecified only</option>
        </select>

        <select
          className="filter-select"
          value={activeFilters.priority ?? ""}
          onChange={e => setFilter("priority", e.target.value)}
        >
          <option value="">All Priority</option>
          <option value="true">⚡ Priority only</option>
          <option value="false">Normal only</option>
        </select>

        {/* Status: default "open", "all" shows open+planned */}
        <select
          className="filter-select"
          value={activeFilters.status ?? "open"}
          onChange={e => setFilter("status", e.target.value)}
        >
          <option value="open">Open only</option>
          <option value="planned">Planned only</option>
          <option value="all">Open + Planned</option>
        </select>

        {priorityCount > 0 && (
          <button
            className="filter-tag filter-tag-priority"
            onClick={() => {
              const priorityIds = filtered.filter(s => s.priority).map(s => s.id);
              setSelected(prev => {
                const next = new Set(prev);
                priorityIds.forEach(id => next.add(id));
                return next;
              });
            }}
          >
            ⚡ Select all {priorityCount} urgent
          </button>
        )}
      </div>

      {/* Select All bar */}
      {filtered.length > 0 && (
        <div className="slab-select-bar">
          <label className="slab-select-all">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleAll}
            />
            <span>Select all {filtered.length} visible</span>
          </label>
          {selected.size > 0 && (
            <button className="ghost-button" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </div>
      )}

      {/* Grouped Slab List */}
      {filtered.length === 0 ? (
        <div className="banner">No slabs match your filters.</div>
      ) : (
        <div className="slab-view-list">
          {[...grouped.entries()].map(([temple, groupSlabs]) => {
            const groupIds = groupSlabs.map(s => s.id);
            const allGroupSelected = groupIds.every(id => selected.has(id));
            const someGroupSelected = groupIds.some(id => selected.has(id));

            return (
              <div key={temple} className="slab-group">
                <div className="slab-group-header">
                  <label className="slab-group-check">
                    <input
                      type="checkbox"
                      checked={allGroupSelected}
                      ref={el => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                      onChange={() => toggleGroup(groupIds)}
                    />
                    <span className="slab-group-name">{temple}</span>
                  </label>
                  <span className="slab-group-count">{groupSlabs.length} slabs</span>
                </div>

                <div className="slab-group-rows">
                  {groupSlabs.map(slab => {
                    const cft = ((Number(slab.length_ft) * Number(slab.width_ft) * Number(slab.thickness_ft)) / 1728).toFixed(2);
                    const isChecked = selected.has(slab.id);

                    return (
                      <label
                        key={slab.id}
                        className={`slab-row${isChecked ? " slab-row-selected" : ""}${slab.priority ? " slab-row-priority" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleOne(slab.id)}
                        />
                        <div className="slab-row-main">
                          <div className="slab-row-top">
                            <code className="slab-row-code">{slab.id}</code>
                            {slab.priority && <span className="slab-priority-badge">⚡ Urgent</span>}
                            {slab.stone && (
                              <span className={`role-pill ${slab.stone === "PinkStone" ? "badge-pink" : "badge-white-stone"}`}>
                                {slab.stone === "PinkStone" ? "Pink" : "White"}
                              </span>
                            )}
                            {slab.quality && (
                              <span className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                                {slab.quality === "A" ? "A" : "B"}
                              </span>
                            )}
                            <span className={`role-pill ${slab.status === "open" ? "badge-open" : "badge-planned"}`}>
                              {slab.status}
                            </span>
                          </div>
                          <div className="slab-row-label">{slab.label}</div>
                          {slab.priority && slab.priority_note && (
                            <div style={{ fontSize: 11, color: "#DC2626", fontStyle: "italic", marginTop: 2 }}>
                              &ldquo;{slab.priority_note}&rdquo;
                            </div>
                          )}
                        </div>
                        <div className="slab-row-dims">
                          <span>{Number(slab.length_ft)}" × {Number(slab.width_ft)}" × {Number(slab.thickness_ft)}"</span>
                          <span className="muted">{cft} CFT</span>
                          {slab.created_at && <span className="muted" style={{ fontSize: 11 }}>Added {fmtDate(slab.created_at)}</span>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Send Button */}
      {selected.size > 0 && (
        <div className="slab-send-sticky">
          <div className="slab-send-sticky-inner">
            <span><strong>{selected.size}</strong> slabs selected</span>
            <button className="primary-button" onClick={sendToPlanning}>
              Send to Plan Generator →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
