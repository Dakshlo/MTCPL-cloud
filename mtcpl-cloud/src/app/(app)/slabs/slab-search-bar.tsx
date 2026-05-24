"use client";

/**
 * Required-Sizes page search.
 *
 * Two states:
 *   • collapsed — a thin bar above the slab list. Click to open.
 *   • expanded — center-peek modal (Notion-style overlay). Search
 *     across slab id / label / temple / stone / dimensions. Click
 *     anywhere outside the modal (or press Esc) to close.
 *
 * Filters the same `slabs` array the parent page already loaded —
 * no extra DB round-trip. Hands you a click target that scrolls
 * the matching slab card into view in the SlabGrid below.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type Slab = {
  id: string;
  label: string;
  description?: string | null;
  temple: string;
  stone: string | null;
  quality: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
};

export function SlabSearchBar({ slabs }: { slabs: Slab[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Daksh May 2026 — when a query (esp. a dimension like 27x15x15)
  // returns slabs across multiple temples, the user wants to narrow
  // by temple. Empty string = all temples. Resets every time the
  // query text changes so it doesn't get stuck on a stale value.
  const [templeFilter, setTempleFilter] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the temple chip when the user re-types — otherwise picking
  // "Aasta Temple" and then searching for something unrelated would
  // silently filter out every other temple's matches.
  useEffect(() => {
    setTempleFilter("");
  }, [q]);

  // Focus the input when the modal opens.
  useEffect(() => {
    if (open) {
      // Defer one tick so the autoFocus fires after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc key closes.
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

  // Compute the full pre-temple-filter matches first so the temple
  // chips can show the WHOLE temple set the query produced (not just
  // what's left after a temple is already picked). Cap at 200 here —
  // bigger than the visible 50 so the chip-counts stay accurate even
  // when results overflow the visible list.
  const rawMatches = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return slabs.slice(0, 200);
    // Permutations of L×W×T so partial dim text like "27x15" hits
    // any orientation. Same trick used on /carving search.
    return slabs
      .filter((s) => {
        if (s.id.toLowerCase().includes(lower)) return true;
        if (s.label.toLowerCase().includes(lower)) return true;
        if (s.temple.toLowerCase().includes(lower)) return true;
        if ((s.stone ?? "").toLowerCase().includes(lower)) return true;
        const L = s.length_ft;
        const W = s.width_ft;
        const T = s.thickness_ft;
        const perms = [
          `${L}x${W}x${T}`,
          `${L}x${T}x${W}`,
          `${W}x${L}x${T}`,
          `${W}x${T}x${L}`,
          `${T}x${L}x${W}`,
          `${T}x${W}x${L}`,
        ];
        for (const p of perms) {
          if (p.toLowerCase().includes(lower)) return true;
        }
        return false;
      })
      .slice(0, 200);
  }, [slabs, q]);

  // Distinct temples in the raw match set + counts, so the chip strip
  // can render "TEMPLE · N" and the user can narrow with one tap.
  const templeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rawMatches) {
      const t = s.temple || "(no temple)";
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rawMatches]);

  // Apply the temple chip filter on top of the raw matches, then
  // cap to 50 for render.
  const results = useMemo(() => {
    const narrowed = templeFilter
      ? rawMatches.filter((s) => s.temple === templeFilter)
      : rawMatches;
    return narrowed.slice(0, 50);
  }, [rawMatches, templeFilter]);

  // Click on a result — scroll the slab card into view in the
  // SlabGrid below, briefly highlight it, and close the modal.
  function handleSelect(slabId: string) {
    setOpen(false);
    // Wait for the modal to close first.
    setTimeout(() => {
      const card = document.querySelector(`[data-slab-id="${CSS.escape(slabId)}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        // Brief outline pulse so the user can see which one matched.
        const original = card.style.boxShadow;
        card.style.transition = "box-shadow 0.3s";
        card.style.boxShadow = "0 0 0 3px var(--gold)";
        setTimeout(() => { card.style.boxShadow = original; }, 1400);
      }
    }, 60);
  }

  return (
    <>
      {/* Collapsed bar — sits between AddSlabForm and the slab list */}
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
          margin: "12px 0 18px",
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
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
        <span style={{ fontSize: 16, opacity: 0.6 }}>🔎</span>
        <span style={{ flex: 1, color: "var(--muted)", fontSize: 13 }}>
          Search slabs by id, label, temple, stone, or dimensions…
        </span>
        <kbd
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          Click to open
        </kbd>
      </div>

      {/* Center-peek modal */}
      {open && (
        <div
          // Backdrop catches clicks outside the dialog → close.
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            left: "var(--content-left)",
            right: 0,
            bottom: 0,
            background: "rgba(15, 12, 6, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "12vh",
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
              maxWidth: 640,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Search input */}
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18, opacity: 0.7 }}>🔎</span>
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by id, label, temple, stone, dimensions…"
                style={{
                  flex: 1,
                  fontSize: 15,
                  padding: "6px 0",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                }}
              />
              <kbd
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "var(--bg)",
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

            {/* Daksh May 2026 — temple filter chip strip. Only shown
                when the current query hits >1 temple, otherwise
                there's nothing to narrow. Each chip carries a count
                of slabs for that temple in the current match set. */}
            {templeCounts.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  padding: "8px 14px",
                  background: "var(--surface-alt, #fafaf7)",
                  borderBottom: "1px solid var(--border)",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginRight: 4,
                  }}
                >
                  🏛 Temple
                </span>
                <button
                  type="button"
                  onClick={() => setTempleFilter("")}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: templeFilter === "" ? "var(--gold-dark)" : "var(--surface)",
                    color: templeFilter === "" ? "#fff" : "var(--muted)",
                    border: `1px solid ${templeFilter === "" ? "var(--gold-dark)" : "var(--border)"}`,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  All ({rawMatches.length})
                </button>
                {templeCounts.map(([temple, count]) => {
                  const isActive = templeFilter === temple;
                  return (
                    <button
                      key={temple}
                      type="button"
                      onClick={() => setTempleFilter(isActive ? "" : temple)}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: isActive ? "var(--gold-dark)" : "var(--surface)",
                        color: isActive ? "#fff" : "var(--text)",
                        border: `1px solid ${isActive ? "var(--gold-dark)" : "var(--border)"}`,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={`${temple} · ${count} slab${count === 1 ? "" : "s"}`}
                    >
                      {temple} · {count}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Results list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {results.length === 0 ? (
                <div
                  style={{
                    padding: "32px 18px",
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}
                >
                  No slabs match &ldquo;{q}&rdquo;.
                </div>
              ) : (
                results.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelect(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 16px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-light)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      transition: "background 0.08s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-alt)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--gold-dark)",
                        minWidth: 110,
                      }}
                    >
                      {s.id}
                    </span>
                    <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text)" }}>
                        {s.label}
                        {s.priority && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "#DC2626", fontWeight: 700 }}>⚡</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        🏛 {s.temple} · {s.stone ?? "—"}
                        {s.quality ? ` · Grade ${s.quality}` : ""}
                      </div>
                    </span>
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.length_ft}×{s.width_ft}×{s.thickness_ft}″
                    </span>
                    <span
                      className="role-pill"
                      style={{
                        fontSize: 9,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.status}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "8px 16px",
                borderTop: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--muted)",
                background: "var(--bg)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {templeFilter ? (
                  <>
                    {results.length} match{results.length === 1 ? "" : "es"}{" "}
                    in <strong>{templeFilter}</strong>
                  </>
                ) : results.length === 50 ? (
                  "Showing first 50 — refine search to see more"
                ) : (
                  `${results.length} match${results.length === 1 ? "" : "es"}`
                )}
              </span>
              <span style={{ fontStyle: "italic" }}>Click any row to jump to it in the list below</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
