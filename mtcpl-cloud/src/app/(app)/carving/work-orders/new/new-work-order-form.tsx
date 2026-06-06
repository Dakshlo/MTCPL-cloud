"use client";

import { useMemo, useState } from "react";
import { createWorkOrderAction } from "../../actions";

export type VendorOpt = { id: string; name: string };
export type PickableSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  status: string;
  dims: string;
};

const STATUS = {
  cut_done: { label: "Ready", icon: "✅", bg: "rgba(22,163,74,0.14)", fg: "#15803d" },
  planned: { label: "Planned", icon: "⏳", bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  open: { label: "Open", icon: "○", bg: "rgba(100,116,139,0.14)", fg: "#475569" },
} as const;
function tone(s: string) {
  return STATUS[s as keyof typeof STATUS] ?? STATUS.open;
}

const RENDER_CAP = 120;

export function NewWorkOrderForm({ vendors, slabs }: { vendors: VendorOpt[]; slabs: PickableSlab[] }) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [temple, setTemple] = useState("");
  const [rate, setRate] = useState("");
  const [unit, setUnit] = useState<"cft" | "sft">("cft");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "cut_done" | "uncut">("all");

  const readyCount = useMemo(() => slabs.filter((s) => s.status === "cut_done").length, [slabs]);
  const uncutCount = slabs.length - readyCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return slabs.filter((s) => {
      if (statusFilter === "cut_done" && s.status !== "cut_done") return false;
      if (statusFilter === "uncut" && s.status === "cut_done") return false;
      if (!q) return true;
      return (
        s.id.toLowerCase().includes(q) ||
        (s.label ?? "").toLowerCase().includes(q) ||
        s.temple.toLowerCase().includes(q) ||
        (s.stone ?? "").toLowerCase().includes(q) ||
        s.dims.toLowerCase().includes(q)
      );
    });
  }, [slabs, search, statusFilter]);

  const shown = filtered.slice(0, RENDER_CAP);

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAllFiltered() {
    setSelected((p) => {
      const n = new Set(p);
      for (const s of filtered) n.add(s.id);
      return n;
    });
  }

  const linesJson = JSON.stringify([...selected].map((id) => ({ slab_requirement_id: id })));
  const canSubmit = !!vendorId && selected.size > 0;

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

  return (
    <form action={createWorkOrderAction} style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80 }}>
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
            <span style={lbl}>Rate (optional)</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="₹/unit" style={{ ...inp, flex: 1, minWidth: 0 }} />
              {(["cft", "sft"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} style={{ padding: "0 12px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", border: `1.5px solid ${unit === u ? "#92400e" : "var(--border)"}`, background: unit === u ? "rgba(146,64,14,0.08)" : "var(--surface)", color: unit === u ? "#92400e" : "var(--muted)", borderRadius: 8, cursor: "pointer" }}>{u}</button>
              ))}
            </div>
          </label>
        </div>
      </section>

      {/* ── Slab picker card ── */}
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

        {/* Search + status filter */}
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--border)" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍  Search by id, label, temple, stone or size…" style={{ ...inp, width: "100%", fontSize: 14, padding: "11px 14px" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {([
              { k: "all", t: `All (${slabs.length})` },
              { k: "cut_done", t: `✅ Ready to send (${readyCount})` },
              { k: "uncut", t: `⏳ Not yet cut (${uncutCount})` },
            ] as const).map((f) => (
              <button key={f.k} type="button" onClick={() => setStatusFilter(f.k)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 999, cursor: "pointer", border: `1px solid ${statusFilter === f.k ? "#92400e" : "var(--border)"}`, background: statusFilter === f.k ? "#92400e" : "var(--bg)", color: statusFilter === f.k ? "#fff" : "var(--muted)" }}>{f.t}</button>
            ))}
            <button type="button" onClick={selectAllFiltered} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}>+ Select all shown</button>
          </div>
        </div>

        {/* List */}
        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {shown.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No matching slabs.</div>
          ) : (
            shown.map((s) => {
              const on = selected.has(s.id);
              const t = tone(s.status);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 18px",
                    borderTop: "1px solid var(--border)",
                    background: on ? "rgba(146,64,14,0.06)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, border: `2px solid ${on ? "#92400e" : "var(--border)"}`, background: on ? "#92400e" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900 }}>{on ? "✓" : ""}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{s.id}</span>
                    {s.label ? <span style={{ fontSize: 13 }}> · {s.label}</span> : ""}
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>
                      {s.temple}{s.stone ? ` · ${s.stone}` : ""} · {s.dims}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: t.fg, background: t.bg, borderRadius: 999, padding: "3px 9px" }}>{t.icon} {t.label}</span>
                </button>
              );
            })
          )}
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
          Showing {shown.length} of {filtered.length}{filtered.length > RENDER_CAP ? " — refine the search to see the rest" : ""}.
          {" "}<span style={{ color: "#15803d" }}>✅ Ready</span> slabs can be sent now; <span style={{ color: "#b45309" }}>⏳ not-cut</span> ones wait until cut, then you Send them.
        </div>
      </section>

      {/* ── Sticky create bar ── */}
      <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 18px", boxShadow: "0 -2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: selected.size ? "var(--text)" : "var(--muted)" }}>
          {selected.size > 0 ? `${selected.size} slab${selected.size === 1 ? "" : "s"} in this work order` : "Select at least one slab"}
        </div>
        <button type="submit" disabled={!canSubmit} style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canSubmit ? "#92400e" : "var(--border)", border: "none", borderRadius: 8, cursor: canSubmit ? "pointer" : "not-allowed" }}>
          Create work order
        </button>
      </div>
    </form>
  );
}
