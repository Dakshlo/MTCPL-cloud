"use client";

/**
 * The Excel-style grid on the dispatch Check page. Identical slabs are already
 * collapsed into grouped rows server-side; here the user flips any row between
 * CFT (default) and SFT — the row jumps to the matching group — then Verifies
 * (creates challan + truck leaves) or Cancels (all slabs back to Make Dispatch).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  verifyDispatchAction,
  removeSlabsFromDispatchAction,
  cancelDispatchAction,
  addSlabsToDispatchAction,
  fetchTempleStorageSlabsAction,
} from "../../actions";
import { dash, type DispatchGroupRow } from "@/lib/dispatch-grouping";

export type AvailableSlab = {
  id: string;
  label: string | null;
  /** Pre-formatted "L×W×T in". */
  dimensions: string;
  cft: number;
  /** "main" or a vendor-shed station id (Mig 160). Undefined for storage slabs. */
  station?: string;
  /** Set when the slab was pulled in from storage via a toggle. */
  storageSource?: "carving" | "dispatch";
};

// Daksh: Category 2 is shown BEFORE Category 1 across the challan + invoice.
const COLS = ["Code(s)", "Label", "Description", "Additional", "Cat 2", "Cat 1", "L", "W", "H", "Qty", "Weight (kg)"] as const;

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function CheckGrid({
  dispatchId,
  groups,
  challanLabel,
  available,
  temple,
  vendorSheds = [],
  canUseStorage = false,
  initialWeightMode = "slab",
  initialLoadTonnes = 0,
}: {
  dispatchId: string;
  groups: DispatchGroupRow[];
  challanLabel: string;
  available: AvailableSlab[];
  temple: string;
  /** Mig 160 — vendor sheds for the "All dispatch" station filter. */
  vendorSheds?: { id: string; name: string }[];
  /** Whether the role can pull carving/dispatch storage slabs into the picker. */
  canUseStorage?: boolean;
  /** Mig 163 — saved weight mode + whole-truck weight (for undo→re-check). */
  initialWeightMode?: "slab" | "truck";
  initialLoadTonnes?: number;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [addQuery, setAddQuery] = useState("");
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  // Station filter (Mig 160) — main only by default; "All dispatch" includes sheds.
  const [allDispatch, setAllDispatch] = useState(false);
  const shedName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of vendorSheds) m[v.id] = v.name;
    return m;
  }, [vendorSheds]);
  // Storage inclusion (Mig 125 follow-on) — lazily loaded the first time a
  // toggle is flipped on, then merged into the picker.
  const [inclCarving, setInclCarving] = useState(false);
  const [inclDispatch, setInclDispatch] = useState(false);
  const [storage, setStorage] = useState<{ carving: AvailableSlab[]; dispatch: AvailableSlab[] }>({ carving: [], dispatch: [] });
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [loadingStorage, setLoadingStorage] = useState(false);
  async function ensureStorage() {
    if (storageLoaded || loadingStorage) return;
    setLoadingStorage(true);
    try {
      const res = await fetchTempleStorageSlabsAction(temple);
      const map = (s: { id: string; label: string | null; dimensions: string; cft: number }, src: "carving" | "dispatch"): AvailableSlab =>
        ({ id: s.id, label: s.label, dimensions: s.dimensions, cft: s.cft, storageSource: src });
      setStorage({
        carving: res.carving.map((s) => map(s, "carving")),
        dispatch: res.dispatch.map((s) => map(s, "dispatch")),
      });
      setStorageLoaded(true);
    } catch {
      /* leave empty — user can retry the toggle */
    } finally {
      setLoadingStorage(false);
    }
  }

  // Base ready slabs, station-filtered, plus any toggled-in storage; then search.
  const mergedAvail = useMemo(() => {
    const base = allDispatch ? available : available.filter((s) => (s.station ?? "main") === "main");
    return [
      ...base,
      ...(inclCarving ? storage.carving : []),
      ...(inclDispatch ? storage.dispatch : []),
    ];
  }, [available, allDispatch, inclCarving, inclDispatch, storage]);
  const filteredAvail = mergedAvail.filter((s) => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return true;
    return s.id.toLowerCase().includes(q) || (s.label ?? "").toLowerCase().includes(q);
  });
  // Only currently-visible picks are submitted — a slab picked from a storage
  // source/station that's since been toggled off is NOT silently added (matches
  // the Make Dispatch board). Search-filtering does NOT drop picks, only the
  // station/storage toggles do.
  const visibleIds = useMemo(() => new Set(mergedAvail.map((s) => s.id)), [mergedAvail]);
  const submitIds = pickedIds.filter((id) => visibleIds.has(id));
  const [unitByKey, setUnitByKey] = useState<Record<string, "cft" | "sft">>(() => {
    const m: Record<string, "cft" | "sft"> = {};
    for (const g of groups) m[g.key] = g.measure_unit;
    return m;
  });
  // Editable per-ROW weight, entered in KG (the group total). Saved on Verify,
  // converted to tonnes and split evenly across the row's slabs.
  const [weightByKey, setWeightByKey] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const g of groups) m[g.key] = g.weightTonnes > 0 ? String(Math.round(g.weightTonnes * 1000)) : "";
    return m;
  });
  // Mig 163 — weigh per slab (default) OR enter ONE whole-truck weight. In truck
  // mode the per-row weight cells go "—" and a single load-weight (kg) is used.
  const [weightMode, setWeightMode] = useState<"slab" | "truck">(initialWeightMode);
  const [truckKg, setTruckKg] = useState<string>(initialLoadTonnes > 0 ? String(Math.round(initialLoadTonnes * 1000)) : "");
  const truckKgNum = Number(truckKg) || 0;
  const truckTonnes = truckKgNum / 1000;
  // Edit Description / Additional for the challan + invoice ONLY (never the
  // slab / Temple View). Locked behind a toggle so a normal verify can't change
  // text by accident; the edited rows are saved as per-slab overrides on Verify.
  const [editDesc, setEditDesc] = useState(false);
  const [descByKey, setDescByKey] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const g of groups) m[g.key] = g.description ?? "";
    return m;
  });
  const [addlByKey, setAddlByKey] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const g of groups) m[g.key] = g.additional_description ?? "";
    return m;
  });

  const unitOf = (g: DispatchGroupRow): "cft" | "sft" => unitByKey[g.key] ?? g.measure_unit;
  const measureOf = (g: DispatchGroupRow, u: "cft" | "sft") => (u === "sft" ? g.sftEach : g.cftEach) * g.qty;
  const weightKgOf = (g: DispatchGroupRow) => Number(weightByKey[g.key]) || 0;

  const cftGroups = groups.filter((g) => unitOf(g) === "cft");
  const sftGroups = groups.filter((g) => unitOf(g) === "sft");

  const unitsJson = useMemo(() => {
    const map: Record<string, "cft" | "sft"> = {};
    for (const g of groups) {
      const u = unitOf(g);
      for (const sid of g.slabIds) map[sid] = u;
    }
    return JSON.stringify(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitByKey, groups]);

  // Per-slab weight in TONNES = the row's kg total / 1000, split across slabs.
  // In whole-truck mode every per-slab weight is cleared to 0 (the load weight
  // lives on the dispatch, not slab-wise).
  const weightsJson = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of groups) {
      const perTonnes = weightMode === "truck"
        ? 0
        : g.qty > 0 ? (Number(weightByKey[g.key]) || 0) / 1000 / g.qty : 0;
      for (const sid of g.slabIds) map[sid] = perTonnes;
    }
    return JSON.stringify(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightByKey, groups, weightMode]);

  // Per-slab description overrides — ONLY rows the user actually changed. A null
  // field means "unchanged → fall back to the slab's own value" on the server.
  const descsJson = useMemo(() => {
    const map: Record<string, { d: string | null; a: string | null }> = {};
    for (const g of groups) {
      const d = descByKey[g.key] ?? g.description ?? "";
      const a = addlByKey[g.key] ?? g.additional_description ?? "";
      const dChanged = d !== (g.description ?? "");
      const aChanged = a !== (g.additional_description ?? "");
      if (!dChanged && !aChanged) continue;
      for (const sid of g.slabIds) map[sid] = { d: dChanged ? d : null, a: aChanged ? a : null };
    }
    return JSON.stringify(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descByKey, addlByKey, groups]);
  const hasDescEdits = descsJson !== "{}";

  const totalSlabs = groups.reduce((a, g) => a + g.qty, 0);
  const totalKg = groups.reduce((a, g) => a + weightKgOf(g), 0);
  const totalTonnes = totalKg / 1000;
  const cftTotal = cftGroups.reduce((a, g) => a + measureOf(g, "cft"), 0);
  const sftTotal = sftGroups.reduce((a, g) => a + measureOf(g, "sft"), 0);

  // Weight is MANDATORY before verifying (Daksh) — either EVERY row has a weight
  // (per-slab mode) or a single whole-truck load weight is entered (truck mode).
  const missingWeightRows = weightMode === "slab" ? groups.filter((g) => weightKgOf(g) <= 0).length : 0;
  const weightOk = weightMode === "truck" ? truckKgNum > 0 : missingWeightRows === 0;

  // Full cell borders → an Excel-style grid (column lines as well as row lines).
  const cell: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" };
  const head: React.CSSProperties = { padding: "7px 9px", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", border: "1px solid var(--border)", borderBottomWidth: 2, whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--surface)" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace" };
  const descInput: React.CSSProperties = { width: "100%", minWidth: 130, fontSize: 12.5, padding: "5px 7px", borderRadius: 7, border: "1.5px solid #2563eb", background: "var(--bg)", color: "var(--text)" };

  function Section({ rows, unit }: { rows: DispatchGroupRow[]; unit: "cft" | "sft" }) {
    if (rows.length === 0) return null;
    const total = rows.reduce((a, g) => a + measureOf(g, unit), 0);
    const slabN = rows.reduce((a, g) => a + g.qty, 0);
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "9px 14px", background: unit === "cft" ? "rgba(37,99,235,0.08)" : "rgba(217,119,6,0.1)", borderBottom: "1px solid var(--border)", fontWeight: 800, fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{unit === "cft" ? "📦 CFT (volume)" : "🟧 SFT (area)"} · {rows.length} row{rows.length !== 1 ? "s" : ""} · {slabN} slab{slabN !== 1 ? "s" : ""}</span>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>Total {fmt(total)} {unit}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr>
                {COLS.map((c, i) => (
                  <th key={i} style={{ ...head, textAlign: c === "L" || c === "W" || c === "H" || c === "Qty" || c === "Weight (kg)" ? "right" : "left" }}>{c}</th>
                ))}
                <th style={{ ...head, textAlign: "right" }}>{unit.toUpperCase()}</th>
                <th style={{ ...head, textAlign: "center" }}>Unit</th>
                <th style={{ ...head, textAlign: "center" }}>—</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const cur = unitOf(g);
                return (
                  <tr key={g.key}>
                    <td style={{ ...cell, fontFamily: "ui-monospace, monospace", fontWeight: 700, maxWidth: 180 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {g.codes.map((c) => (
                          <span key={c} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 5px", fontSize: 11 }}>{c}</span>
                        ))}
                      </div>
                    </td>
                    <td style={cell}>{dash(g.label)}</td>
                    <td style={{ ...cell, maxWidth: editDesc ? 240 : 220 }}>
                      {editDesc ? (
                        <input value={descByKey[g.key] ?? ""} onChange={(e) => setDescByKey((p) => ({ ...p, [g.key]: e.target.value }))} placeholder="—" style={descInput} />
                      ) : dash(g.description)}
                    </td>
                    <td style={{ ...cell, maxWidth: editDesc ? 220 : 200 }}>
                      {editDesc ? (
                        <input value={addlByKey[g.key] ?? ""} onChange={(e) => setAddlByKey((p) => ({ ...p, [g.key]: e.target.value }))} placeholder="—" style={descInput} />
                      ) : dash(g.additional_description)}
                    </td>
                    {/* Cat 2 before Cat 1 (Daksh) */}
                    <td style={cell}>{dash(g.component_element)}</td>
                    <td style={cell}>{dash(g.component_section)}</td>
                    <td style={numCell}>{g.length_ft}</td>
                    <td style={numCell}>{g.width_ft}</td>
                    <td style={numCell}>{g.thickness_ft}</td>
                    <td style={{ ...numCell, fontWeight: 800 }}>{g.qty}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {weightMode === "truck" ? (
                        <span style={{ color: "var(--muted)" }} title="Whole-truck weight is entered once above">—</span>
                      ) : (
                        <>
                          <input
                            type="number"
                            min={0}
                            step="1"
                            inputMode="decimal"
                            value={weightByKey[g.key] ?? ""}
                            onChange={(e) => setWeightByKey((p) => ({ ...p, [g.key]: e.target.value }))}
                            placeholder="kg ⚠"
                            title={weightKgOf(g) > 0 ? (g.qty > 1 ? "Total weight in kg for all pieces in this row" : "Weight in kg") : "Weight is required for every row"}
                            style={{ width: 84, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: "5px 7px", borderRadius: 7, border: `1.5px solid ${weightKgOf(g) > 0 ? "var(--border)" : "#dc2626"}`, background: weightKgOf(g) > 0 ? "var(--bg)" : "rgba(220,38,38,0.07)", color: "var(--text)" }}
                          />
                          {weightKgOf(g) > 0 && (
                            <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>{fmt(weightKgOf(g) / 1000, 3)} T</div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ ...numCell, fontWeight: 700 }}>{fmt(measureOf(g, cur))}</td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
                        {(["cft", "sft"] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setUnitByKey((p) => ({ ...p, [g.key]: u }))}
                            style={{
                              padding: "4px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", border: "none",
                              background: cur === u ? (u === "cft" ? "#2563eb" : "#D97706") : "var(--bg)",
                              color: cur === u ? "#fff" : "var(--muted)",
                            }}
                          >
                            {u.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <form
                        action={removeSlabsFromDispatchAction}
                        style={{ display: "inline" }}
                        onSubmit={(e) => {
                          if (!confirm(`Remove ${g.codes.join(", ")} (${g.qty} slab${g.qty !== 1 ? "s" : ""}) from this dispatch? It goes back to Make Dispatch.`)) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="id" value={dispatchId} />
                        <input type="hidden" name="slab_ids" value={JSON.stringify(g.slabIds)} />
                        <button type="submit" title="Remove → back to Make Dispatch" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>✕</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="muted" style={{ padding: "28px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
        No slabs on this dispatch.
      </div>
    );
  }

  return (
    <div>
      {/* Edit-descriptions toggle — unlocks the Description + Additional columns
          for THIS challan/invoice only (never the slab or Temple View). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12, padding: "9px 13px", border: `1.5px solid ${editDesc ? "#2563eb" : "var(--border)"}`, borderRadius: 10, background: editDesc ? "rgba(37,99,235,0.06)" : "var(--surface)" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
          <input type="checkbox" checked={editDesc} onChange={(e) => setEditDesc(e.target.checked)} />
          ✏️ Edit Description / Additional
        </label>
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
          Changes apply to this challan &amp; invoice only — the slab and Temple View stay as they are.
        </span>
        {hasDescEdits && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#2563eb" }}>● edits will save on Verify</span>}
      </div>

      {/* Weight mode (Mig 163) — weigh per slab, or enter ONE whole-truck weight. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12, padding: "9px 13px", border: `1.5px solid ${weightMode === "truck" ? "#0d9488" : "var(--border)"}`, borderRadius: 10, background: weightMode === "truck" ? "rgba(13,148,136,0.07)" : "var(--surface)" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>⚖ Weight</span>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {([["slab", "Per slab"], ["truck", "Whole truck"]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setWeightMode(m)}
              style={{
                padding: "6px 13px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", border: "none",
                background: weightMode === m ? (m === "truck" ? "#0d9488" : "#2563eb") : "var(--bg)",
                color: weightMode === m ? "#fff" : "var(--muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {weightMode === "truck" ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700 }}>
            🚚 Truck load weight
            <input
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              value={truckKg}
              onChange={(e) => setTruckKg(e.target.value)}
              placeholder="kg ⚠"
              style={{ width: 120, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "7px 9px", borderRadius: 8, border: `1.5px solid ${truckKgNum > 0 ? "#0d9488" : "#dc2626"}`, background: truckKgNum > 0 ? "var(--bg)" : "rgba(220,38,38,0.07)", color: "var(--text)" }}
            />
            <span style={{ color: truckKgNum > 0 ? "var(--muted)" : "#dc2626", fontFamily: "ui-monospace, monospace", fontWeight: truckKgNum > 0 ? 400 : 800 }}>{truckKgNum > 0 ? `= ${fmt(truckTonnes, 3)} T` : "required"}</span>
          </label>
        ) : (
          <span style={{ fontSize: 11.5, color: missingWeightRows > 0 ? "#dc2626" : "var(--muted)", fontWeight: missingWeightRows > 0 ? 800 : 600 }}>
            {missingWeightRows > 0
              ? `⚠ Weight required — ${missingWeightRows} row${missingWeightRows !== 1 ? "s" : ""} still need a weight (or switch to “Whole truck”).`
              : "Weighing each slab — every row must have a weight. Switch to “Whole truck” to enter a single load weight instead."}
          </span>
        )}
      </div>

      {/* Called inline (not <Section/>) so editing the weight input doesn't
          remount the table and lose focus after one keystroke. */}
      {Section({ rows: cftGroups, unit: "cft" })}
      {Section({ rows: sftGroups, unit: "sft" })}

      {/* Totals */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, fontWeight: 700, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", marginBottom: 16 }}>
        <span>Σ {totalSlabs} slab{totalSlabs !== 1 ? "s" : ""}</span>
        {cftTotal > 0 && <span style={{ color: "#2563eb" }}>📦 {fmt(cftTotal)} CFT</span>}
        {sftTotal > 0 && <span style={{ color: "#D97706" }}>🟧 {fmt(sftTotal)} SFT</span>}
        {weightMode === "truck"
          ? truckKgNum > 0 && <span style={{ color: "#0d9488" }}>🚚 {fmt(truckTonnes, 3)} T <span style={{ color: "var(--muted)", fontWeight: 600 }}>(whole truck · {truckKgNum.toLocaleString("en-IN")} kg)</span></span>
          : totalKg > 0 && <span>⚖ {fmt(totalTonnes, 3)} T <span style={{ color: "var(--muted)", fontWeight: 600 }}>({totalKg.toLocaleString("en-IN")} kg)</span></span>}
      </div>

      {/* Add more slabs — ready pool + (toggle) carving / dispatch storage, and
          a station filter for Main vs vendor sheds. */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", marginBottom: 16, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          style={{ width: "100%", textAlign: "left", padding: "11px 14px", fontSize: 13.5, fontWeight: 800, background: "transparent", border: "none", cursor: "pointer", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>➕ Add slab from {temple} · {mergedAvail.length} available</span>
          <span style={{ color: "var(--muted)" }}>{showAdd ? "▲" : "▼"}</span>
        </button>
        {showAdd && (
          <div style={{ padding: "0 14px 14px" }}>
            {/* Source toggles — vendor-shed station + carving/dispatch storage. */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "8px 0 10px", marginBottom: 8, borderBottom: "1px solid var(--border)" }}>
              {vendorSheds.length > 0 && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--gold-dark)" }}>
                  <input type="checkbox" checked={allDispatch} onChange={(e) => setAllDispatch(e.target.checked)} />
                  🔓 All dispatch (Main + sheds)
                </label>
              )}
              {canUseStorage && (
                <>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#6d28d9" }}>
                    <input type="checkbox" checked={inclCarving} onChange={(e) => { setInclCarving(e.target.checked); if (e.target.checked) ensureStorage(); }} />
                    📦 Carving storage {storageLoaded && <span className="muted" style={{ fontWeight: 600 }}>· {storage.carving.length}</span>}
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#1d4ed8" }}>
                    <input type="checkbox" checked={inclDispatch} onChange={(e) => { setInclDispatch(e.target.checked); if (e.target.checked) ensureStorage(); }} />
                    🗄 Dispatch storage {storageLoaded && <span className="muted" style={{ fontWeight: 600 }}>· {storage.dispatch.length}</span>}
                  </label>
                  {loadingStorage && <span className="muted" style={{ fontSize: 11.5 }}>Loading…</span>}
                </>
              )}
            </div>

            <form action={addSlabsToDispatchAction}>
              <input type="hidden" name="id" value={dispatchId} />
              <input type="hidden" name="slab_ids" value={JSON.stringify(submitIds)} />
              <input
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="🔍 Search code / label…"
                style={{ width: "100%", maxWidth: 340, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", marginBottom: 10 }}
              />
              {filteredAvail.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  No slabs to add{addQuery ? ` matching “${addQuery}”` : ` for ${temple}`}{!allDispatch && vendorSheds.length > 0 ? " — try “All dispatch”." : "."}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                  {filteredAvail.map((s) => {
                    const on = !!picked[s.id];
                    const shed = s.station && s.station !== "main" ? shedName[s.station] : null;
                    return (
                      <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", border: `1.5px solid ${on ? "#15803d" : s.storageSource ? (s.storageSource === "carving" ? "#7c3aed" : "#2563eb") : "var(--border)"}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer", background: on ? "rgba(22,101,52,0.06)" : s.storageSource ? (s.storageSource === "carving" ? "rgba(124,58,237,0.06)" : "rgba(37,99,235,0.06)") : "var(--bg)" }}>
                        <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.checked }))} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12.5 }}>{s.id}</span>
                            {s.storageSource && (
                              <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", background: s.storageSource === "carving" ? "#7c3aed" : "#2563eb", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.02em" }}>
                                {s.storageSource === "carving" ? "📦 CARVING STORE" : "🗄 STORE"}
                              </span>
                            )}
                            {shed && (
                              <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", borderRadius: 3, padding: "1px 5px" }}>🏬 {shed}</span>
                            )}
                          </span>
                          <span style={{ fontSize: 11.5, color: "var(--muted)", display: "block" }}>
                            {dash(s.label)} · {s.dimensions} · {fmt(s.cft)} cft
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <button
                type="submit"
                disabled={submitIds.length === 0}
                style={{ marginTop: 12, fontSize: 13.5, padding: "10px 18px", fontWeight: 800, color: "#fff", background: submitIds.length ? "#2563eb" : "var(--border)", border: "none", borderRadius: 10, cursor: submitIds.length ? "pointer" : "default" }}
              >
                ➕ Add {submitIds.length || ""} selected slab{submitIds.length !== 1 ? "s" : ""}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Verify / Cancel */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <form
          action={verifyDispatchAction}
          style={{ display: "inline" }}
          onSubmit={(e) => {
            if (!weightOk) {
              e.preventDefault();
              alert(weightMode === "truck"
                ? "Weight is mandatory — enter the whole-truck load weight before verifying."
                : `Weight is mandatory — ${missingWeightRows} row${missingWeightRows !== 1 ? "s" : ""} still need a weight (or switch to “Whole truck”).`);
            }
          }}
        >
          <input type="hidden" name="id" value={dispatchId} />
          <input type="hidden" name="units" value={unitsJson} />
          <input type="hidden" name="weights" value={weightsJson} />
          <input type="hidden" name="descs" value={descsJson} />
          <input type="hidden" name="weight_mode" value={weightMode} />
          <input type="hidden" name="truck_weight" value={weightMode === "truck" ? String(truckTonnes) : ""} />
          <button type="submit" disabled={!weightOk} title={weightOk ? undefined : "Enter weight first — per slab or whole truck"} style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: weightOk ? "#15803d" : "var(--border)", border: "none", borderRadius: 11, cursor: weightOk ? "pointer" : "not-allowed" }}>
            ✅ Verify — create challan &amp; send truck
          </button>
        </form>
        <form
          action={cancelDispatchAction}
          style={{ display: "inline" }}
          onSubmit={(e) => {
            if (!confirm(`Cancel ${challanLabel}? Every slab goes back to Make Dispatch.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={dispatchId} />
          <button type="submit" style={{ fontSize: 13.5, padding: "12px 20px", fontWeight: 700, color: "#b91c1c", background: "var(--bg)", border: "1.5px solid rgba(220,38,38,0.4)", borderRadius: 11, cursor: "pointer" }}>
            ✕ Cancel dispatch — slabs back to Make Dispatch
          </button>
        </form>
        {/* Preview carries the current (unsaved) cft/sft toggles so the grouped
            challan matches what's on screen before verifying. */}
        <Link
          href={`/dispatch/${dispatchId}/print?units=${encodeURIComponent(unitsJson)}&weights=${encodeURIComponent(weightsJson)}${hasDescEdits ? `&descs=${encodeURIComponent(descsJson)}` : ""}${weightMode === "truck" ? `&weight_mode=truck&truck_weight=${encodeURIComponent(String(truckTonnes))}` : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, padding: "12px 16px", fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 11, textDecoration: "none" }}
        >
          🖨 Preview challan
        </Link>
      </div>
    </div>
  );
}
