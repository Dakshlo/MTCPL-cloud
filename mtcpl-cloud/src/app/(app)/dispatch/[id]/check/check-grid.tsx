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
} from "../../actions";
import { dash, type DispatchGroupRow } from "@/lib/dispatch-grouping";

const COLS = ["Code(s)", "Label", "Description", "Additional", "Cat 1", "Cat 2", "L", "W", "H", "Qty", "Weight (T)", "", ""] as const;

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function CheckGrid({
  dispatchId,
  groups,
  challanLabel,
}: {
  dispatchId: string;
  groups: DispatchGroupRow[];
  challanLabel: string;
}) {
  const [unitByKey, setUnitByKey] = useState<Record<string, "cft" | "sft">>(() => {
    const m: Record<string, "cft" | "sft"> = {};
    for (const g of groups) m[g.key] = g.measure_unit;
    return m;
  });
  const unitOf = (g: DispatchGroupRow): "cft" | "sft" => unitByKey[g.key] ?? g.measure_unit;
  const measureOf = (g: DispatchGroupRow, u: "cft" | "sft") => (u === "sft" ? g.sftEach : g.cftEach) * g.qty;

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

  const totalSlabs = groups.reduce((a, g) => a + g.qty, 0);
  const totalWeight = groups.reduce((a, g) => a + g.weightTonnes, 0);
  const cftTotal = cftGroups.reduce((a, g) => a + measureOf(g, "cft"), 0);
  const sftTotal = sftGroups.reduce((a, g) => a + measureOf(g, "sft"), 0);

  const cell: React.CSSProperties = { padding: "7px 9px", borderBottom: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" };
  const head: React.CSSProperties = { padding: "7px 9px", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--surface)" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace" };

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
                  <th key={i} style={{ ...head, textAlign: c === "L" || c === "W" || c === "H" || c === "Qty" || c === "Weight (T)" ? "right" : "left" }}>{c}</th>
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
                    <td style={{ ...cell, maxWidth: 220 }}>{dash(g.description)}</td>
                    <td style={{ ...cell, maxWidth: 200 }}>{dash(g.additional_description)}</td>
                    <td style={cell}>{dash(g.component_section)}</td>
                    <td style={cell}>{dash(g.component_element)}</td>
                    <td style={numCell}>{g.length_ft}</td>
                    <td style={numCell}>{g.width_ft}</td>
                    <td style={numCell}>{g.thickness_ft}</td>
                    <td style={{ ...numCell, fontWeight: 800 }}>{g.qty}</td>
                    <td style={numCell}>{g.weightTonnes > 0 ? fmt(g.weightTonnes, 3) : "-"}</td>
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
                      <form action={removeSlabsFromDispatchAction} style={{ display: "inline" }}>
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
      <Section rows={cftGroups} unit="cft" />
      <Section rows={sftGroups} unit="sft" />

      {/* Totals */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, fontWeight: 700, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", marginBottom: 16 }}>
        <span>Σ {totalSlabs} slab{totalSlabs !== 1 ? "s" : ""}</span>
        {cftTotal > 0 && <span style={{ color: "#2563eb" }}>📦 {fmt(cftTotal)} CFT</span>}
        {sftTotal > 0 && <span style={{ color: "#D97706" }}>🟧 {fmt(sftTotal)} SFT</span>}
        {totalWeight > 0 && <span>⚖ {fmt(totalWeight, 3)} T</span>}
      </div>

      {/* Verify / Cancel */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <form action={verifyDispatchAction} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={dispatchId} />
          <input type="hidden" name="units" value={unitsJson} />
          <button type="submit" style={{ fontSize: 14.5, padding: "12px 24px", fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 11, cursor: "pointer" }}>
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
        <Link
          href={`/dispatch/${dispatchId}/print`}
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
