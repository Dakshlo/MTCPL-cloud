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

function fmtSmartDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return "Today " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function stoneBadgeClass(stone: string | null) {
  if (stone === "PinkStone") return "badge-pink";
  if (stone === "WhiteStone") return "badge-white-stone";
  return "";
}

export function ReadySlabsClient({ slabs }: { slabs: Slab[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return slabs;
    return slabs.filter(s => {
      const dims = `${Number(s.length_ft)}x${Number(s.width_ft)}x${Number(s.thickness_ft)}`;
      const dimsSpace = `${Number(s.length_ft)} ${Number(s.width_ft)} ${Number(s.thickness_ft)}`;
      return (
        s.id.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.temple.toLowerCase().includes(q) ||
        (s.stone || "").toLowerCase().includes(q) ||
        (s.quality || "").toLowerCase().includes(q) ||
        dims.includes(q) ||
        dimsSpace.includes(q)
      );
    });
  }, [slabs, search]);

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by code, label, temple, stone, grade, dimensions…"
          style={{ width: "100%", maxWidth: 520 }}
        />
      </div>

      {/* Summary */}
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {slabs.length} ready slabs
      </p>

      {filtered.length === 0 ? (
        <div className="banner">{slabs.length === 0 ? "No slabs have been cut yet." : "No slabs match your search."}</div>
      ) : (
        <div className="records-stack">
          {filtered.map(slab => {
            const cft = ((Number(slab.length_ft) * Number(slab.width_ft) * Number(slab.thickness_ft)) / 1728).toFixed(2);
            return (
              <div className="record-card compact-record" key={slab.id}>
                <div className="record-head">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>{slab.id}</strong>
                      {slab.priority && <span style={{ fontSize: 11 }}>⚡</span>}
                      {slab.stone && (
                        <span className={`role-pill ${stoneBadgeClass(slab.stone)}`}>
                          {slab.stone === "PinkStone" ? "Pink" : "White"}
                        </span>
                      )}
                      {slab.quality && (
                        <span className="role-pill" style={{ background: slab.quality === "A" ? "#d4edda" : "#fff3cd", color: slab.quality === "A" ? "#155724" : "#856404", fontWeight: 700 }}>
                          Grade {slab.quality}
                        </span>
                      )}
                    </div>
                    <p className="muted" style={{ margin: "3px 0 0", fontSize: 13 }}>
                      {slab.temple} · {slab.label}
                    </p>
                    <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                      {Number(slab.length_ft)}" × {Number(slab.width_ft)}" × {Number(slab.thickness_ft)}" · {cft} CFT
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <span className="role-pill badge-consumed">Cut Done</span>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Added: {fmtSmartDate(slab.created_at)}
                    </p>
                    <p className="muted" style={{ fontSize: 12, marginTop: 1 }}>
                      Cut: {fmtSmartDate(slab.updated_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
