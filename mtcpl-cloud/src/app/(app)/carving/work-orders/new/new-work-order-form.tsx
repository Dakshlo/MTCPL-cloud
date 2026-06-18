"use client";

import { useMemo, useState } from "react";
import { createWorkOrderAction } from "../../actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { SlabComponentDetail } from "@/components/slab-component-detail";

export type VendorOpt = { id: string; name: string };
export type PickableSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  status: string;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  stock_location: string | null;
  updated_at: string | null;
  description?: string | null;
  component_section?: string | null;
  component_element?: string | null;
  additional_description?: string | null;
};

const STATUS = {
  cut_done: { label: "Ready", icon: "✅", bg: "rgba(22,163,74,0.14)", fg: "#15803d" },
  planned: { label: "Planned", icon: "⏳", bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  open: { label: "Open", icon: "○", bg: "rgba(100,116,139,0.14)", fg: "#475569" },
} as const;
function tone(s: string) {
  return STATUS[s as keyof typeof STATUS] ?? STATUS.open;
}
function readyAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Cap how many cards render in one temple peek so a 900-slab temple
// doesn't paint 900 SVG cubes at once — the in-peek filter narrows it.
const RENDER_CAP = 200;

export function NewWorkOrderForm({
  vendors,
  slabs,
  stoneTypes,
}: {
  vendors: VendorOpt[];
  slabs: PickableSlab[];
  stoneTypes: StoneTypeDef[];
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [temple, setTemple] = useState("");
  const [rate, setRate] = useState("");
  // Mig 100 — 'job' = a flat ₹ per slab (not by volume).
  const [unit, setUnit] = useState<"cft" | "sft" | "job">("cft");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(""); // top-level temple filter
  const [openTemple, setOpenTemple] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState("");

  // Group slabs by temple (mirrors the Unassigned tab's temple cards).
  const byTemple = useMemo(() => {
    const m = new Map<string, PickableSlab[]>();
    for (const s of slabs) {
      const arr = m.get(s.temple) ?? [];
      arr.push(s);
      m.set(s.temple, arr);
    }
    return [...m.entries()]
      .map(([t, list]) => ({ temple: t, list }))
      .sort((a, b) => a.temple.localeCompare(b.temple));
  }, [slabs]);

  const templeCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byTemple;
    return byTemple.filter((t) => t.temple.toLowerCase().includes(q));
  }, [byTemple, search]);

  const openList = useMemo(() => {
    if (!openTemple) return [];
    const list = byTemple.find((t) => t.temple === openTemple)?.list ?? [];
    const q = modalFilter.trim().toLowerCase();
    if (!q) return list;
    const qDim = q.replace(/[×*]/g, "x");
    return list.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.label ?? "").toLowerCase().includes(q) ||
        (s.stock_location ?? "").toLowerCase().includes(q) ||
        `${s.length_ft}x${s.width_ft}x${s.thickness_ft}`.includes(qDim),
    );
  }, [openTemple, byTemple, modalFilter]);

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const pickedIn = (list: PickableSlab[]) =>
    list.reduce((acc, s) => acc + (selected.has(s.id) ? 1 : 0), 0);

  const linesJson = JSON.stringify([...selected].map((id) => ({ slab_requirement_id: id })));
  // Mig 100 — price is OPTIONAL at creation; the owner sets/approves it.
  const canSubmit = !!vendorId && selected.size > 0;
  // Selected slabs, for the review chips so the head can confirm the set.
  const selectedSlabs = useMemo(() => slabs.filter((s) => selected.has(s.id)), [slabs, selected]);

  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 } as const;
  const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em" };
  const inp = { padding: "9px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" };

  if (vendors.length === 0) {
    return (
      <div style={{ ...card, color: "var(--muted)" }}>
        No active Outsource vendors. Add one in Carving Jobs → Manage Vendors first.
      </div>
    );
  }

  const shown = openList.slice(0, RENDER_CAP);

  return (
    <form action={createWorkOrderAction} style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 90 }}>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="temple" value={temple} />
      <input type="hidden" name="jobwork_rate" value={rate} />
      <input type="hidden" name="jobwork_unit" value={unit} />
      <input type="hidden" name="lines_json" value={linesJson} />

      {/* ── Details card ── */}
      <section style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Vendor</span>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sukhadia pillar set" style={inp} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Temple (optional)</span>
            <input value={temple} onChange={(e) => setTemple(e.target.value)} style={inp} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Rate (optional · owner approves)</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={unit === "job" ? "₹/slab (flat)" : "₹/unit"} style={{ ...inp, flex: 1, minWidth: 0 }} />
              {(["cft", "sft", "job"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} style={{ padding: "0 12px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", border: `1.5px solid ${unit === u ? "#92400e" : "var(--border)"}`, background: unit === u ? "rgba(146,64,14,0.08)" : "var(--surface)", color: unit === u ? "#92400e" : "var(--muted)", borderRadius: 8, cursor: "pointer" }}>{u}</button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--muted-light)" }}>
              {unit === "job" ? "Job = a flat ₹ per slab (not by volume)." : `By volume — ₹ per ${unit}.`} You can leave it blank — the owner sets/approves the price.
            </span>
          </label>
        </div>
      </section>

      {/* ── Temple picker (mirrors the Unassigned tab) ── */}
      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            Slabs to outsource
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, color: "#fff", background: selected.size ? "#92400e" : "var(--border)", borderRadius: 999, padding: "2px 10px" }}>{selected.size} selected</span>
          </div>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", background: "none", border: "none", cursor: "pointer" }}>Clear all</button>
          )}
        </div>

        {/* Selected-slabs review — so the head can confirm the full set
            (every picked slab, across all temples), not just a count. */}
        {selected.size > 0 && (
          <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "rgba(146,64,14,0.03)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Selected ({selectedSlabs.length}) — tap × to remove
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 132, overflowY: "auto" }}>
              {selectedSlabs.map((s) => (
                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#7c2d12", background: "rgba(146,64,14,0.08)", border: "1px solid rgba(146,64,14,0.3)", borderRadius: 999, padding: "3px 4px 3px 10px" }}>
                  {s.id}
                  <button type="button" onClick={() => toggle(s.id)} title="Remove" style={{ border: "none", background: "rgba(146,64,14,0.18)", color: "#7c2d12", borderRadius: "50%", width: 16, height: 16, lineHeight: 1, fontSize: 12, fontWeight: 900, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍  Search temples…" style={{ ...inp, width: "100%", fontSize: 14, padding: "11px 14px" }} />
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            {slabs.length} slabs across {byTemple.length} temples. Click a temple to view + pick its slabs.
          </div>
          {templeCards.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No temples match.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {templeCards.map((t) => {
                const picked = pickedIn(t.list);
                const ready = t.list.filter((s) => s.status === "cut_done").length;
                return (
                  <button
                    key={t.temple}
                    type="button"
                    onClick={() => { setOpenTemple(t.temple); setModalFilter(""); }}
                    style={{
                      textAlign: "left",
                      background: picked ? "rgba(146,64,14,0.05)" : "var(--surface)",
                      border: `1.5px solid ${picked ? "#92400e" : "var(--border)"}`,
                      borderRadius: 12,
                      padding: 16,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>🏛 Temple</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", borderRadius: 999, padding: "2px 9px" }}>{t.list.length}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.25 }}>{t.temple}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      <span style={{ color: "#15803d", fontWeight: 700 }}>{ready} ready</span>
                      {t.list.length - ready > 0 ? ` · ${t.list.length - ready} not cut` : ""}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: picked ? "#92400e" : "var(--gold-dark)" }}>
                      {picked > 0 ? `✓ ${picked} picked · edit →` : "Open & pick →"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Sticky create bar ── */}
      <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 18px", boxShadow: "0 -2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: selected.size ? "var(--text)" : "var(--muted)" }}>
          {selected.size === 0
            ? "Open a temple and pick at least one slab"
            : `${selected.size} slab${selected.size === 1 ? "" : "s"} · will go for owner approval`}
        </div>
        <button type="submit" disabled={!canSubmit} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canSubmit ? "#92400e" : "var(--border)", border: "none", borderRadius: 8, cursor: canSubmit ? "pointer" : "not-allowed" }}>
          Create work order
        </button>
      </div>

      {/* ── Temple peek modal (big slab cards, multi-select) ── */}
      {openTemple && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenTemple(null); }}
          style={{ position: "fixed", inset: 0, left: "var(--content-left)", background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", zIndex: 1200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 12px 12px" }}
        >
          <div role="dialog" aria-modal="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", width: "100%", maxWidth: 1040, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>🏛 Temple</div>
                <h2 style={{ margin: "2px 0 0", fontSize: 18 }}>{openTemple}</h2>
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                  {openList.length} slabs · <span style={{ color: "#92400e", fontWeight: 700 }}>{pickedIn(openList)} picked</span> — tap a card to add it to the work order.
                </p>
              </div>
              <button type="button" onClick={() => setOpenTemple(null)} style={{ fontSize: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 4 }} aria-label="Close">✕</button>
            </div>

            {/* Filter */}
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
              <input value={modalFilter} onChange={(e) => setModalFilter(e.target.value)} placeholder="🔍  Filter — slab id, label, stock loc, or 53x29x14" style={{ ...inp, width: "100%", fontSize: 14, padding: "11px 14px" }} />
            </div>

            {/* Cards */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {shown.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No matching slabs.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                  {shown.map((s) => {
                    const on = selected.has(s.id);
                    const t = tone(s.status);
                    const ago = s.status === "cut_done" ? readyAgo(s.updated_at) : null;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s.id)}
                        style={{
                          position: "relative",
                          textAlign: "left",
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
                          padding: 10,
                          background: on ? "rgba(146,64,14,0.06)" : "var(--surface)",
                          border: `2px solid ${on ? "#92400e" : "var(--border)"}`,
                          borderRadius: 12,
                          cursor: "pointer",
                        }}
                      >
                        {/* Tick overlay */}
                        <div style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 6, background: on ? "#92400e" : "var(--surface)", border: `2px solid ${on ? "#92400e" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 14, zIndex: 1, boxShadow: on ? "0 2px 6px rgba(146,64,14,0.4)" : "none" }}>{on ? "✓" : ""}</div>
                        <SlabThumb stone={s.stone} l={s.length_ft} w={s.width_ft} t={s.thickness_ft} stoneTypes={stoneTypes} />
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</span>
                          {s.stone && <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>{s.stone}</span>}
                        </div>
                        <SlabComponentDetail
                          section={s.component_section}
                          element={s.component_element}
                          label={s.label}
                          description={s.description}
                          additional={s.additional_description}
                        />
                        <div style={{ fontSize: 10, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>{s.length_ft}×{s.width_ft}×{s.thickness_ft}&Prime;</div>
                        {s.stock_location && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#7c2d12", background: "rgba(180,115,51,0.08)", border: "1px solid rgba(180,115,51,0.25)", padding: "3px 7px", borderRadius: 5, alignSelf: "flex-start", fontFamily: "ui-monospace, monospace" }}>📍 {s.stock_location}</div>
                        )}
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: t.fg, background: t.bg, borderRadius: 999, padding: "3px 9px", alignSelf: "flex-start" }}>
                          {t.icon} {ago ? `ready ${ago}` : t.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {openList.length > RENDER_CAP && (
                <div style={{ padding: "12px 4px 0", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                  Showing {RENDER_CAP} of {openList.length} — type in the filter to narrow down.
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{selected.size} total in work order</span>
              <button type="button" onClick={() => setOpenTemple(null)} style={{ padding: "10px 22px", fontSize: 14, fontWeight: 800, color: "#fff", background: "#92400e", border: "none", borderRadius: 8, cursor: "pointer" }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
