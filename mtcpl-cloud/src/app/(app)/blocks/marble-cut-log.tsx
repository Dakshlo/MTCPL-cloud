"use client";

/**
 * Marble Cutting Log — center-peek modal showing every consumed
 * marble block with the slabs that came out of it. Lets the team
 * justify "what we cut and what we got" day-by-day, stone-by-stone.
 *
 * UX matches the SlabSearchBar / BlockSearchBar pattern:
 *   • collapsed card on the page (sits next to Block Report)
 *   • click → center-peek modal (Notion-style overlay)
 *   • click outside / Esc → closes
 *
 * Inside the modal:
 *   • filter bar: stone (Yellow / White / All), date range
 *   • list grouped by date (newest first)
 *   • each block row: dims, tonnage, vendor, who cut it, list of
 *     slab IDs + dims + status
 *
 * Pure client filtering over the array the page already loaded.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type CutSlab = {
  id: string;
  label: string | null;
  temple: string;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
};

type MarbleCutBlock = {
  id: string;
  stone: string;
  yard: number;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes: number | null;
  truck_no: string | null;
  vendor_name: string | null;
  cut_at: string | null;
  cut_by_name: string | null;
  slabs: CutSlab[];
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function dateKey(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toISOString().slice(0, 10);
}
function cft(l: number | null, w: number | null, h: number | null): number {
  if (!l || !w || !h) return 0;
  return (l * w * h) / 1728;
}

export function MarbleCutLog({ entries }: { entries: MarbleCutBlock[] }) {
  const [open, setOpen] = useState(false);
  const [stoneFilter, setStoneFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Distinct stone names in the dataset for the filter dropdown.
  const stoneOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.stone) set.add(e.stone);
    return [...set].sort();
  }, [entries]);

  // Apply filters.
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (stoneFilter !== "all" && e.stone !== stoneFilter) return false;
      if (dateFrom && (!e.cut_at || dateKey(e.cut_at) < dateFrom)) return false;
      if (dateTo && (!e.cut_at || dateKey(e.cut_at) > dateTo)) return false;
      return true;
    });
  }, [entries, stoneFilter, dateFrom, dateTo]);

  // Group by date (yyyy-mm-dd) for the section headers.
  const groups = useMemo(() => {
    const m = new Map<string, MarbleCutBlock[]>();
    for (const e of filtered) {
      const k = dateKey(e.cut_at);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => ({ key, items }));
  }, [filtered]);

  // Aggregates for the header summary inside the modal.
  const totals = useMemo(() => {
    let blocks = filtered.length;
    let totalTonnes = 0;
    let totalSlabs = 0;
    let totalSlabCft = 0;
    for (const e of filtered) {
      if (e.tonnes != null) totalTonnes += e.tonnes;
      totalSlabs += e.slabs.length;
      for (const s of e.slabs) totalSlabCft += cft(s.length_ft, s.width_ft, s.thickness_ft);
    }
    return { blocks, totalTonnes, totalSlabs, totalSlabCft };
  }, [filtered]);

  return (
    <>
      {/* Collapsed card — sits next to Block Report card */}
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          flex: "1 1 280px",
          padding: "14px 18px",
          background: "var(--surface)",
          border: "2px dashed var(--border)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-alt)";
          e.currentTarget.style.borderColor = "var(--gold-dark)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--surface)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
            🪨 Marble Cutting Log
          </p>
          <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
            {entries.length} marble block{entries.length === 1 ? "" : "s"} cut · what came out, day-by-day · Yellow / White filter
          </p>
        </div>
        <span
          className="role-pill"
          style={{ background: "var(--gold)", color: "#fff", fontWeight: 700, whiteSpace: "nowrap" }}
        >
          Open log →
        </span>
      </div>

      {/* Center-peek modal */}
      {open && (
        <div
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 12, 6, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "8vh",
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
              width: "100%",
              maxWidth: 880,
              maxHeight: "84vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header + filters */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>🪨 Marble Cutting Log</h2>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                    Every marble block we&rsquo;ve cut, in order. Filter by stone or date.
                  </p>
                </div>
                <kbd
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                  title="Close"
                >
                  Esc
                </kbd>
              </div>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label className="stack" style={{ flex: "0 0 auto" }}>
                  <span>Stone</span>
                  <select value={stoneFilter} onChange={(e) => setStoneFilter(e.target.value)}>
                    <option value="all">All marble stones</option>
                    {stoneOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="stack" style={{ flex: "0 0 auto" }}>
                  <span>From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    style={{ minWidth: 140 }}
                  />
                </label>
                <label className="stack" style={{ flex: "0 0 auto" }}>
                  <span>To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    style={{ minWidth: 140 }}
                  />
                </label>
                {(stoneFilter !== "all" || dateFrom || dateTo) && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => { setStoneFilter("all"); setDateFrom(""); setDateTo(""); }}
                    style={{ fontSize: 12 }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Aggregates */}
              <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                <span>
                  <strong style={{ color: "var(--text)" }}>{totals.blocks}</strong> block{totals.blocks === 1 ? "" : "s"}
                </span>
                <span>
                  <strong style={{ color: "var(--text)" }}>{totals.totalTonnes.toFixed(2)} T</strong> raw
                </span>
                <span>
                  <strong style={{ color: "var(--text)" }}>{totals.totalSlabs}</strong> slab{totals.totalSlabs === 1 ? "" : "s"}
                </span>
                <span>
                  <strong style={{ color: "var(--text)" }}>{totals.totalSlabCft.toFixed(2)} CFT</strong> yielded
                </span>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 16px" }}>
              {filtered.length === 0 ? (
                <div
                  style={{
                    padding: "48px 16px",
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}
                >
                  No marble blocks match the current filters.
                </div>
              ) : (
                groups.map(({ key, items }) => (
                  <section key={key} style={{ marginTop: 14 }}>
                    {/* Date heading */}
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--gold-dark)",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        marginBottom: 6,
                        paddingBottom: 4,
                        borderBottom: "1px solid var(--border-light)",
                      }}
                    >
                      📅 {fmtDate(items[0].cut_at)}
                      <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 6 }}>
                        · {items.length} block{items.length === 1 ? "" : "s"} cut
                      </span>
                    </div>

                    {/* Block rows for this date */}
                    {items.map((b) => {
                      const blockCft = cft(b.length_ft, b.width_ft, b.height_ft);
                      const slabCft = b.slabs.reduce(
                        (sum, s) => sum + cft(s.length_ft, s.width_ft, s.thickness_ft),
                        0,
                      );
                      const yieldPct = blockCft > 0 ? Math.min(99, Math.round((slabCft / blockCft) * 100)) : 0;
                      return (
                        <div
                          key={b.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "12px 14px",
                            marginBottom: 10,
                            background: "var(--surface)",
                          }}
                        >
                          {/* Block header */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                              <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "var(--gold-dark)" }}>{b.id}</strong>
                              <span className="role-pill" style={{ fontSize: 10 }}>{b.stone}</span>
                              <span className="muted" style={{ fontSize: 11 }}>
                                Yard {b.yard}
                                {b.tonnes ? ` · ${b.tonnes.toFixed(2)} T` : ""}
                                {b.length_ft && b.width_ft && b.height_ft
                                  ? ` · ${b.length_ft}×${b.width_ft}×${b.height_ft}″`
                                  : ""}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {b.cut_by_name && <>by <strong style={{ color: "var(--text)" }}>{b.cut_by_name}</strong> · </>}
                              {fmtDateTime(b.cut_at)}
                            </div>
                          </div>

                          {/* Slab list */}
                          {b.slabs.length === 0 ? (
                            <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                              No cut-done slab requirements linked to this block (may have been cut without a slab plan).
                            </div>
                          ) : (
                            <>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>
                                <strong style={{ color: "#15803d" }}>{b.slabs.length} slab{b.slabs.length === 1 ? "" : "s"}</strong>
                                {" "}cut from this block · {slabCft.toFixed(2)} CFT yielded ({yieldPct}%)
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {b.slabs.map((s) => (
                                  <span
                                    key={s.id}
                                    style={{
                                      fontFamily: "ui-monospace, monospace",
                                      fontSize: 11,
                                      padding: "3px 8px",
                                      background: "var(--surface-alt)",
                                      border: "1px solid var(--border-light)",
                                      borderRadius: 6,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                    title={`${s.temple}${s.label ? " · " + s.label : ""} · status: ${s.status}`}
                                  >
                                    <strong style={{ color: "var(--gold-dark)" }}>{s.id}</strong>
                                    <span style={{ color: "var(--muted)" }}>
                                      {s.length_ft}×{s.width_ft}×{s.thickness_ft}″
                                    </span>
                                    {s.status !== "cut_done" && (
                                      <span style={{ fontSize: 9, color: "#15803d", fontWeight: 700 }}>
                                        ✓ {s.status}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
