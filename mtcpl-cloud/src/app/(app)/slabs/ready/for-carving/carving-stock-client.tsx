"use client";

// ──────────────────────────────────────────────────────────────────
// Ready Sizes Stock — read-only carving stock board (Daksh, June 2026)
//
// A bird's-eye, temple-grouped card view of EVERY live slab on the
// system (any status except broken/rejected), built for the carving
// department. Cards are colour-coded by assignment:
//
//   • normal   — not yet assigned to any vendor (open / planned / cut)
//   • blue     — assigned to a CNC carving vendor (vendor name shown)
//   • yellow   — assigned to an outsource vendor (vendor name shown)
//   • greyed   — carving done (completed / dispatched)
//
// Read-only: no edit drawer, no assign buttons. Search matches code,
// label, temple, stone, block, vendor, or dimensions (e.g. 53x29x14).
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { slabSearchMatch } from "@/lib/slab-search";

export type ColorKind = "normal" | "precut" | "cnc" | "outsource" | "done";

export type StockSlab = {
  id: string;
  label: string;
  description: string | null;
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
  created_by: string | null;
  source_block_id: string | null;
  colorKind: ColorKind;
  vendorName: string | null;
};

function stoneBadge(stone: string | null) {
  if (stone === "PinkStone") return "badge-pink";
  if (stone === "WhiteStone") return "badge-white-stone";
  return "badge-open";
}
function stoneLabel(stone: string | null) {
  if (!stone) return "";
  return stone.replace(/Stone$/i, "") || stone;
}
function statusBadge(status: string) {
  const m: Record<string, string> = {
    open: "badge-open",
    planned: "badge-planned",
    cut_done: "badge-consumed",
    carving_assigned: "badge-reserved",
    carving_in_progress: "badge-reserved",
    completed: "badge-available",
    dispatched: "badge-discarded",
  };
  return m[status] || "badge-open";
}
function fmtDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (isToday) return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "2-digit" });
}

// Card colour overrides per assignment kind.
const KIND_STYLE: Record<ColorKind, React.CSSProperties> = {
  normal: {},
  // Mig 126 — pre-cut: released early; its block is still cutting.
  precut: { background: "rgba(217,119,6,0.10)", borderColor: "rgba(217,119,6,0.6)", borderStyle: "dashed" },
  cnc: { background: "rgba(37,99,235,0.10)", borderColor: "rgba(37,99,235,0.5)" },
  outsource: { background: "rgba(234,179,8,0.13)", borderColor: "rgba(202,138,4,0.55)" },
  done: { filter: "grayscale(1)", opacity: 0.55 },
};
const KIND_LABEL: Record<ColorKind, string> = {
  normal: "Not assigned",
  precut: "Pre-cut (block cutting)",
  cnc: "CNC carving",
  outsource: "Outsource",
  done: "Carving done",
};

function Swatch({ kind }: { kind: ColorKind }) {
  const base: React.CSSProperties = {
    display: "inline-block",
    width: 16,
    height: 16,
    borderRadius: 4,
    border: "1px solid var(--border)",
    flexShrink: 0,
  };
  if (kind === "precut") return <span style={{ ...base, background: "rgba(217,119,6,0.18)", borderColor: "rgba(217,119,6,0.65)", borderStyle: "dashed" }} />;
  if (kind === "cnc") return <span style={{ ...base, background: "rgba(37,99,235,0.18)", borderColor: "rgba(37,99,235,0.6)" }} />;
  if (kind === "outsource") return <span style={{ ...base, background: "rgba(234,179,8,0.22)", borderColor: "rgba(202,138,4,0.6)" }} />;
  if (kind === "done") return <span style={{ ...base, background: "var(--surface-alt, #e5e7eb)", filter: "grayscale(1)", opacity: 0.6 }} />;
  return <span style={{ ...base, background: "var(--surface)" }} />;
}

export function CarvingStockClient({
  slabs,
  profilesMap = {},
}: {
  slabs: StockSlab[];
  profilesMap?: Record<string, string>;
}) {
  const [search, setSearch] = useState("");
  // Colour-key filters — tap a legend swatch to show only that kind.
  // Empty = show all; multiple kinds can be active at once.
  const [kinds, setKinds] = useState<Set<ColorKind>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    // Default: all temples collapsed for a quick overview.
    const out: Record<string, boolean> = {};
    for (const s of slabs) out[s.temple] = true;
    return out;
  });
  const [allExpanded, setAllExpanded] = useState(false);

  // "Not assigned" has a sub-option: also restrict to un-cut (open) slabs —
  // the only place to see all still-uncut required sizes.
  const [uncutOnly, setUncutOnly] = useState(false);

  const searching = search.trim().length > 0;
  const kindActive = kinds.size > 0;

  const toggleKind = (k: ColorKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  // Toggling the "Not assigned" chip; turning it OFF also drops the
  // un-cut sub-filter so it doesn't linger invisibly.
  function toggleNormal() {
    const willBeOn = !kinds.has("normal");
    toggleKind("normal");
    if (!willBeOn) setUncutOnly(false);
  }

  // Un-cut = a required size not yet physically cut (open / planned).
  const isUncut = (s: StockSlab) => s.status === "open" || s.status === "planned";

  const filtered = useMemo(() => {
    return slabs.filter((s) => {
      if (kindActive && !kinds.has(s.colorKind)) return false;
      // Sub-filter: only un-cut not-assigned slabs (doesn't touch other colours).
      if (uncutOnly && s.colorKind === "normal" && !isUncut(s)) return false;
      if (
        searching &&
        !slabSearchMatch(
          search,
          { length_ft: s.length_ft, width_ft: s.width_ft, thickness_ft: s.thickness_ft },
          [s.id, s.label, s.temple, s.stone, s.source_block_id, s.description, s.vendorName],
        )
      ) {
        return false;
      }
      return true;
    });
  }, [slabs, search, searching, kinds, kindActive, uncutOnly]);

  // Counts for the legend (over the full set, not the filtered view).
  const counts = useMemo(() => {
    const c = { normal: 0, precut: 0, cnc: 0, outsource: 0, done: 0 } as Record<ColorKind, number>;
    for (const s of slabs) c[s.colorKind] += 1;
    return c;
  }, [slabs]);
  // How many not-assigned slabs are still un-cut (open / planned).
  const uncutNormalCount = useMemo(
    () => slabs.filter((s) => s.colorKind === "normal" && isUncut(s)).length,
    [slabs],
  );

  // Group by temple, newest activity first.
  const grouped = useMemo(() => {
    const map = new Map<string, StockSlab[]>();
    for (const s of filtered) {
      const list = map.get(s.temple) ?? [];
      list.push(s);
      map.set(s.temple, list);
    }
    const out: Array<{ temple: string; slabs: StockSlab[]; latestAt: string }> = [];
    for (const [temple, list] of map) {
      const sorted = [...list].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return (b.created_at ?? "") > (a.created_at ?? "") ? 1 : -1;
      });
      const latestAt = list.reduce((mx, s) => ((s.created_at ?? "") > mx ? (s.created_at ?? "") : mx), "");
      out.push({ temple, slabs: sorted, latestAt });
    }
    out.sort((a, b) => (b.latestAt > a.latestAt ? 1 : -1));
    return out;
  }, [filtered]);

  function toggle(temple: string) {
    setCollapsed((p) => ({ ...p, [temple]: !p[temple] }));
  }
  function expandCollapseAll(expand: boolean) {
    const out: Record<string, boolean> = {};
    for (const s of slabs) out[s.temple] = !expand;
    setCollapsed(out);
    setAllExpanded(expand);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Legend ──────────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          gap: 18,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Colour key · tap to filter
        </span>
        {(["normal", "precut", "cnc", "outsource", "done"] as ColorKind[]).map((k) => {
          const on = kinds.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => (k === "normal" ? toggleNormal() : toggleKind(k))}
              aria-pressed={on}
              title="Tap to filter by this colour"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                color: "var(--text)",
                cursor: "pointer",
                padding: "5px 11px",
                borderRadius: 999,
                border: `1px solid ${on ? "var(--gold-dark, #a16207)" : "var(--border)"}`,
                background: on ? "rgba(201,161,74,0.12)" : "var(--bg)",
              }}
            >
              <span style={{ width: 12, textAlign: "center", fontSize: 12, fontWeight: 900, color: "var(--gold-dark, #a16207)" }}>{on ? "✓" : ""}</span>
              <Swatch kind={k} />
              <span style={{ fontWeight: on ? 800 : 700 }}>{KIND_LABEL[k]}</span>
              <span style={{ color: "var(--muted)" }}>· {counts[k]}</span>
            </button>
          );
        })}
        {/* Sub-filter of "Not assigned" — appears once it's ticked. Restricts
            the not-assigned set to still-uncut (open / planned) sizes. */}
        {kinds.has("normal") && (
          <button
            type="button"
            onClick={() => setUncutOnly((v) => !v)}
            aria-pressed={uncutOnly}
            title="Within Not assigned, show only un-cut (open) sizes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--text)",
              cursor: "pointer",
              padding: "5px 11px",
              borderRadius: 999,
              border: `1px dashed ${uncutOnly ? "var(--gold-dark, #a16207)" : "var(--border)"}`,
              background: uncutOnly ? "rgba(201,161,74,0.12)" : "var(--bg)",
            }}
          >
            <span style={{ width: 12, textAlign: "center", fontSize: 12, fontWeight: 900, color: "var(--gold-dark, #a16207)" }}>{uncutOnly ? "✓" : ""}</span>
            ↳ <span style={{ fontWeight: uncutOnly ? 800 : 700 }}>Un-cut (open) only</span>
            <span style={{ color: "var(--muted)" }}>· {uncutNormalCount}</span>
          </button>
        )}
        {kindActive && (
          <button
            type="button"
            onClick={() => { setKinds(new Set()); setUncutOnly(false); }}
            style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Search + expand controls ────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, label, temple, stone, block, vendor, or size (e.g. 53x29x14)…"
          style={{
            flex: "1 1 320px",
            padding: "10px 14px",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <button
          type="button"
          className="ghost-button"
          onClick={() => expandCollapseAll(!allExpanded)}
          style={{ fontSize: 13, padding: "8px 14px", whiteSpace: "nowrap" }}
        >
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {slabs.length} slabs
        {searching ? ` matching "${search.trim()}"` : ""} · read-only
      </p>

      {/* ── Temple groups ───────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {grouped.length === 0 ? (
          <div className="banner">No slabs match the current filter.</div>
        ) : (
          grouped.map(({ temple, slabs: groupSlabs, latestAt }) => {
            const isCollapsed = searching ? false : (collapsed[temple] ?? false);
            const priorityCount = groupSlabs.filter((s) => s.priority).length;
            return (
              <div key={temple}>
                <button
                  type="button"
                  onClick={() => !searching && toggle(temple)}
                  aria-expanded={!isCollapsed}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "2px solid var(--border)",
                    marginBottom: isCollapsed ? 0 : 12,
                    background: "transparent",
                    border: 0,
                    borderBottomWidth: 2,
                    borderBottomStyle: "solid",
                    borderBottomColor: "var(--border)",
                    cursor: searching ? "default" : "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{temple}</span>
                    {priorityCount > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", background: "rgba(220,38,38,0.10)", padding: "2px 8px", borderRadius: 10 }}>
                        ⚡ {priorityCount} urgent
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {latestAt && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        Last added: <strong style={{ color: "var(--text)" }}>{fmtDate(latestAt)}</strong>
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                      {groupSlabs.length} {groupSlabs.length === 1 ? "size" : "sizes"}
                    </span>
                    {!searching && (
                      <span style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {isCollapsed ? "Show" : "Hide"}
                        <span style={{ fontSize: 10 }}>{isCollapsed ? "▶" : "▼"}</span>
                      </span>
                    )}
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="slab-card-grid">
                    {groupSlabs.map((slab) => {
                      const cft = ((Number(slab.length_ft) * Number(slab.width_ft) * Number(slab.thickness_ft)) / 1728).toFixed(2);
                      return (
                        <div
                          key={slab.id}
                          className={`slab-card${slab.priority ? " slab-card-priority" : ""}`}
                          style={{ cursor: "default", ...KIND_STYLE[slab.colorKind] }}
                        >
                          {slab.priority && <div className="slab-priority-bar" />}
                          <div className="slab-card-top">
                            <code className="slab-card-code">{slab.id}</code>
                            {slab.priority && <span className="slab-priority-dot">⚡</span>}
                          </div>
                          <div className="slab-card-label">{slab.label}</div>
                          {slab.description && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 1, fontStyle: "italic" }}>
                              {slab.description}
                            </div>
                          )}
                          <div className="slab-card-dims">
                            {Number(slab.length_ft)}&quot; × {Number(slab.width_ft)}&quot; × {Number(slab.thickness_ft)}&quot;
                          </div>
                          <div className="slab-card-footer">
                            {slab.stone && <span className={`role-pill ${stoneBadge(slab.stone)}`}>{stoneLabel(slab.stone)}</span>}
                            {slab.quality && (
                              <span className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                                Grade {slab.quality}
                              </span>
                            )}
                            <span className={`role-pill ${statusBadge(slab.status)}`}>{slab.status.replace(/_/g, " ")}</span>
                            <span className="slab-card-area">{cft} CFT</span>
                          </div>
                          {slab.vendorName && (slab.colorKind === "cnc" || slab.colorKind === "outsource") && (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "3px 9px",
                                borderRadius: 999,
                                background: slab.colorKind === "cnc" ? "rgba(37,99,235,0.15)" : "rgba(202,138,4,0.16)",
                                color: slab.colorKind === "cnc" ? "#1e40af" : "#854d0e",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {slab.colorKind === "cnc" ? "🔧 CNC · " : "🤝 "}{slab.vendorName}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                            {slab.created_at && <>Added {fmtDate(slab.created_at)}</>}
                            {slab.created_by && (
                              <> · <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>by {profilesMap[slab.created_by] ?? "Unknown"}</span></>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
