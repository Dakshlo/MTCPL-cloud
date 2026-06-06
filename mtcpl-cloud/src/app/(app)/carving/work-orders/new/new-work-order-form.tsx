"use client";

import { useMemo, useState } from "react";
import { createWorkOrderAction } from "../../actions";

export type VendorOpt = { id: string; name: string };
export type PickableSlab = {
  id: string;
  label: string | null;
  temple: string;
  status: string;
  dims: string;
};

type Line =
  | { key: string; kind: "slab"; slab_requirement_id: string; label: string; status: string }
  | {
      key: string;
      kind: "future";
      description: string;
      planned_length_ft: number | null;
      planned_width_ft: number | null;
      planned_thickness_ft: number | null;
      qty: number;
    };

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  open: { bg: "rgba(100,116,139,0.14)", fg: "#475569" },
  planned: { bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  cut_done: { bg: "rgba(22,163,74,0.14)", fg: "#15803d" },
};

let counter = 0;
const nextKey = () => `l${++counter}`;

export function NewWorkOrderForm({ vendors, slabs }: { vendors: VendorOpt[]; slabs: PickableSlab[] }) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [temple, setTemple] = useState("");
  const [rate, setRate] = useState("");
  const [unit, setUnit] = useState<"cft" | "sft">("cft");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");

  // Future-need draft
  const [fDesc, setFDesc] = useState("");
  const [fL, setFL] = useState("");
  const [fW, setFW] = useState("");
  const [fT, setFT] = useState("");
  const [fQty, setFQty] = useState("1");

  const usedSlabIds = new Set(lines.filter((l) => l.kind === "slab").map((l) => (l as { slab_requirement_id: string }).slab_requirement_id));
  const filteredSlabs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return slabs
      .filter((s) => !usedSlabIds.has(s.id))
      .filter((s) =>
        !q ||
        s.id.toLowerCase().includes(q) ||
        (s.label ?? "").toLowerCase().includes(q) ||
        s.temple.toLowerCase().includes(q) ||
        s.dims.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [slabs, search, usedSlabIds]);

  function addSlab(s: PickableSlab) {
    setLines((p) => [...p, { key: nextKey(), kind: "slab", slab_requirement_id: s.id, label: s.label ? `${s.id} · ${s.label}` : s.id, status: s.status }]);
  }
  function addFuture() {
    if (!fDesc.trim()) return;
    setLines((p) => [
      ...p,
      {
        key: nextKey(),
        kind: "future",
        description: fDesc.trim(),
        planned_length_ft: fL ? Number(fL) : null,
        planned_width_ft: fW ? Number(fW) : null,
        planned_thickness_ft: fT ? Number(fT) : null,
        qty: Math.max(1, Number(fQty) || 1),
      },
    ]);
    setFDesc(""); setFL(""); setFW(""); setFT(""); setFQty("1");
  }
  function remove(key: string) {
    setLines((p) => p.filter((l) => l.key !== key));
  }

  const linesJson = JSON.stringify(
    lines.map((l) =>
      l.kind === "slab"
        ? { slab_requirement_id: l.slab_requirement_id }
        : {
            description: l.description,
            planned_length_ft: l.planned_length_ft,
            planned_width_ft: l.planned_width_ft,
            planned_thickness_ft: l.planned_thickness_ft,
            qty: l.qty,
          },
    ),
  );
  const canSubmit = vendorId && lines.length > 0;

  const labelStyle = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em" };
  const inputStyle = { padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" };

  if (vendors.length === 0) {
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, color: "var(--muted)" }}>
        No active Outsource vendors. Add one in Carving Jobs → Manage Vendors first.
      </div>
    );
  }

  return (
    <form action={createWorkOrderAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="temple" value={temple} />
      <input type="hidden" name="jobwork_rate" value={rate} />
      <input type="hidden" name="jobwork_unit" value={unit} />
      <input type="hidden" name="lines_json" value={linesJson} />

      {/* Header fields */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
          <span style={labelStyle}>Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ ...inputStyle, fontWeight: 600 }}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
          <span style={labelStyle}>Title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sukhadia pillar set" style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
          <span style={labelStyle}>Temple (optional)</span>
          <input value={temple} onChange={(e) => setTemple(e.target.value)} style={inputStyle} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 180px" }}>
          <span style={labelStyle}>Rate (₹/unit, optional)</span>
          <input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1200" style={inputStyle} />
        </label>
        <div style={{ display: "flex", gap: 4 }}>
          {(["cft", "sft"] as const).map((u) => (
            <button key={u} type="button" onClick={() => setUnit(u)} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", border: `1.5px solid ${unit === u ? "#92400e" : "var(--border)"}`, background: unit === u ? "rgba(146,64,14,0.08)" : "var(--surface)", color: unit === u ? "#92400e" : "var(--muted)", borderRadius: 8, cursor: "pointer" }}>/{u}</button>
          ))}
        </div>
      </div>

      {/* Added lines */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          Work order lines ({lines.length})
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: "14px", fontSize: 13, color: "var(--muted)" }}>No lines yet — add cut/uncut slabs or future-need items below.</div>
        ) : (
          lines.map((l) => (
            <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {l.kind === "slab" ? (
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                    {l.label}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: (STATUS_TONE[l.status] ?? STATUS_TONE.open).fg, background: (STATUS_TONE[l.status] ?? STATUS_TONE.open).bg, borderRadius: 999, padding: "1px 6px" }}>{l.status.replace("_", " ")}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 700 }}>📝 {l.description}</span>
                    <span style={{ color: "var(--muted)" }}>
                      {l.planned_length_ft ? ` · ${l.planned_length_ft}×${l.planned_width_ft ?? "?"}×${l.planned_thickness_ft ?? "?"}″` : ""} · qty {l.qty}
                    </span>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => remove(l.key)} style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
            </div>
          ))
        )}
      </div>

      {/* Add existing slab (any status — incl. uncut) */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Add a slab (cut or not-yet-cut)</div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by id / label / temple / size…" style={{ ...inputStyle, width: "100%" }} />
        <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {filteredSlabs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 0" }}>No matching slabs.</div>
          ) : (
            filteredSlabs.map((s) => (
              <button key={s.id} type="button" onClick={() => addSlab(s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 12.5, minWidth: 0 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{s.id}</span>
                  {s.label ? ` · ${s.label}` : ""} <span style={{ color: "var(--muted)" }}>· {s.temple} · {s.dims}</span>
                </span>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: (STATUS_TONE[s.status] ?? STATUS_TONE.open).fg, background: (STATUS_TONE[s.status] ?? STATUS_TONE.open).bg, borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>{s.status.replace("_", " ")}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Add future-need line */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>…or add a future-need line (no slab yet)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Description, e.g. Pillar — PinkStone" style={{ ...inputStyle, flex: "2 1 220px" }} />
          <input value={fL} onChange={(e) => setFL(e.target.value)} placeholder="L″" style={{ ...inputStyle, width: 64 }} />
          <input value={fW} onChange={(e) => setFW(e.target.value)} placeholder="W″" style={{ ...inputStyle, width: 64 }} />
          <input value={fT} onChange={(e) => setFT(e.target.value)} placeholder="T″" style={{ ...inputStyle, width: 64 }} />
          <input value={fQty} onChange={(e) => setFQty(e.target.value)} placeholder="Qty" style={{ ...inputStyle, width: 60 }} />
          <button type="button" onClick={addFuture} disabled={!fDesc.trim()} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: fDesc.trim() ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 8, cursor: fDesc.trim() ? "pointer" : "not-allowed" }}>Add</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" disabled={!canSubmit} style={{ padding: "10px 22px", fontSize: 14, fontWeight: 800, color: "#fff", background: canSubmit ? "#92400e" : "var(--border)", border: "none", borderRadius: 8, cursor: canSubmit ? "pointer" : "not-allowed" }}>
          Create work order
        </button>
      </div>
    </form>
  );
}
