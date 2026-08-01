"use client";

// ──────────────────────────────────────────────────────────────────
// Carving Plan — client board (mig 215). Four sections:
//   1. Per-method headline cards (total → not-cut → cut-waiting →
//      in-carving → done, slabs + CFT).
//   2. CNC capacity forecast + off-plan card.
//   3. Temple × method matrix (rows expand to the per-stage grid).
//   4. Undecided queue — nil slabs grouped by temple with checkboxes
//      and a sticky "Set method for N selected" bar (the quick-tag
//      flow that replaces walking over to Mohit's desk).
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { METHOD_BADGE, methodLabel, type CarvingMethod } from "@/lib/carving-method";
import { setCarvingMethodBulkAction } from "./actions";

export type MethodKey = CarvingMethod | "nil";
export type Tot = { slabs: number; cft: number };
export type StageTotals = { notCut: Tot; cutWaiting: Tot; inCarving: Tot; done: Tot };
export type MethodSummary = { total: Tot; stages: StageTotals };
export type TempleMethodRow = { temple: string; methods: Record<MethodKey, MethodSummary> };
export type UndecidedSlab = {
  id: string; temple: string; status: string; label: string | null;
  l: number; w: number; t: number; priority: boolean;
};
export type CncForecast = {
  machineCount: number;
  cncPending: Tot;
  cncDone30: Tot;
  outPending: Tot;
  outDone30: Tot;
};

const METHOD_ORDER: MethodKey[] = ["cnc", "outsource", "none", "nil"];
const METHOD_THEME: Record<MethodKey, { label: string; fg: string; bg: string; border: string }> = {
  cnc: { ...METHOD_BADGE.cnc, label: "CNC" },
  outsource: { ...METHOD_BADGE.outsource, label: "Outsource" },
  none: { ...METHOD_BADGE.none, label: "No carving" },
  nil: { label: "Nil — undecided", fg: "#6b7280", bg: "rgba(107,114,128,0.10)", border: "rgba(107,114,128,0.35)" },
};
const STAGE_LABELS: Array<{ key: keyof StageTotals; label: string }> = [
  { key: "notCut", label: "Not cut yet" },
  { key: "cutWaiting", label: "Cut · waiting" },
  { key: "inCarving", label: "In carving" },
  { key: "done", label: "Done" },
];

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function PlanClient({
  summaries, temples, undecided, forecast, offPlanIds,
}: {
  summaries: Record<MethodKey, MethodSummary>;
  temples: TempleMethodRow[];
  undecided: UndecidedSlab[];
  forecast: CncForecast;
  offPlanIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openTemple, setOpenTemple] = useState<string | null>(null);
  const [offPlanOpen, setOffPlanOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openUndTemples, setOpenUndTemples] = useState<Set<string>>(new Set());

  const undecidedByTemple = useMemo(() => {
    const m = new Map<string, UndecidedSlab[]>();
    for (const s of undecided) {
      const arr = m.get(s.temple) ?? [];
      arr.push(s);
      m.set(s.temple, arr);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [undecided]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTempleAll(rows: UndecidedSlab[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = rows.every((r) => next.has(r.id));
      for (const r of rows) {
        if (allIn) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  function applyMethod(method: CarvingMethod) {
    if (selected.size === 0 || pending) return;
    if (!confirm(`Set "${methodLabel(method)}" on ${selected.size} slab${selected.size === 1 ? "" : "s"}?`)) return;
    setMsg(null); setErr(null);
    const fd = new FormData();
    fd.set("ids", JSON.stringify([...selected]));
    fd.set("method", method);
    startTransition(async () => {
      const res = await setCarvingMethodBulkAction(fd);
      if (res.ok) {
        setMsg(`✓ Tagged ${res.count} slab${res.count === 1 ? "" : "s"} as ${methodLabel(method)}`);
        setSelected(new Set());
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  // Forecast derived lines.
  const cncCftPerDay = forecast.cncDone30.cft / 30;
  const cncDays = cncCftPerDay > 0 ? forecast.cncPending.cft / cncCftPerDay : null;
  const outCftPerDay = forecast.outDone30.cft / 30;
  const outDays = outCftPerDay > 0 ? forecast.outPending.cft / outCftPerDay : null;

  const card: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "14px 16px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 90 }}>
      <div className="page-header">
        <div>
          <h1>Carving Plan</h1>
          <p className="muted">
            Route load per method — CNC · Outsource · No carving — plus the undecided queue and the CNC capacity forecast.
          </p>
        </div>
      </div>

      {/* ── 1. Per-method headline cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {METHOD_ORDER.map((mk) => {
          const s = summaries[mk];
          const th = METHOD_THEME[mk];
          const done = s.stages.done;
          return (
            <div key={mk} style={{ ...card, borderTop: `3px solid ${th.fg}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: th.fg }}>
                  {th.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                  {pct(done.slabs, s.total.slabs)}% done
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
                {fmt0(s.total.slabs)} <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>slabs</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginLeft: 8 }}>{fmt0(s.total.cft)} CFT</span>
              </div>
              {/* progress bar: done share */}
              <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden", margin: "8px 0 10px" }}>
                <div style={{ width: `${pct(done.slabs, s.total.slabs)}%`, height: "100%", background: th.fg }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
                {STAGE_LABELS.map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 11.5 }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span style={{ fontWeight: 700 }} title={`${fmt1(s.stages[key].cft)} CFT`}>{fmt0(s.stages[key].slabs)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 2. Forecast + off-plan ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <div style={{ ...card, borderLeft: "4px solid #1d4ed8" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#1d4ed8" }}>
            ⚙️ CNC capacity forecast
          </div>
          <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
            Pending CNC work: <b>{fmt0(forecast.cncPending.slabs)} slabs · {fmt0(forecast.cncPending.cft)} CFT</b>
            <br />
            Done last 30 days: <b>{fmt0(forecast.cncDone30.slabs)} slabs · {fmt0(forecast.cncDone30.cft)} CFT</b>
            {" "}({fmt1(cncCftPerDay)} CFT/day) · <b>{forecast.machineCount}</b> active machines
          </div>
          <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 800, color: cncDays != null && cncDays > 60 ? "#b91c1c" : "#15803d" }}>
            {cncDays == null
              ? "No CNC approvals in the last 30 days — no pace to forecast from."
              : `≈ ${fmt0(cncDays)} days of work at the current pace (~${fmt1(cncDays / 30)} months)`}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
            Pending CFT is raw slab volume; the done pace includes the 2-side multiplier — treat the days as an estimate.
          </div>
        </div>

        <div style={{ ...card, borderLeft: "4px solid #92400e" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#92400e" }}>
            🤝 Outsource pace
          </div>
          <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
            Pending outsource work: <b>{fmt0(forecast.outPending.slabs)} slabs · {fmt0(forecast.outPending.cft)} CFT</b>
            <br />
            Done last 30 days: <b>{fmt0(forecast.outDone30.slabs)} slabs · {fmt0(forecast.outDone30.cft)} CFT</b>
            {" "}({fmt1(outCftPerDay)} CFT/day)
          </div>
          <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 800, color: outDays != null && outDays > 60 ? "#b91c1c" : "#15803d" }}>
            {outDays == null
              ? "No outsource approvals in the last 30 days."
              : `≈ ${fmt0(outDays)} days of work at the current pace`}
          </div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid ${offPlanIds.length > 0 ? "#b91c1c" : "var(--border)"}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: offPlanIds.length > 0 ? "#b91c1c" : "var(--muted)" }}>
            🚧 Off-plan
          </div>
          <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
            {offPlanIds.length === 0 ? (
              <span style={{ color: "var(--muted)" }}>Every carving job matches its slab&apos;s planned route.</span>
            ) : (
              <>
                <b>{offPlanIds.length}</b> slab{offPlanIds.length === 1 ? " was" : "s were"} carved on a DIFFERENT route than planned.
                <button
                  type="button"
                  onClick={() => setOffPlanOpen((v) => !v)}
                  style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}
                >
                  {offPlanOpen ? "hide" : "show ids"}
                </button>
                {offPlanOpen && (
                  <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)", maxHeight: 120, overflowY: "auto" }}>
                    {offPlanIds.join(", ")}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. Temple × method matrix ── */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 800, fontSize: 13.5 }}>
          🏛 Temple-wise route load <span className="muted" style={{ fontWeight: 600, fontSize: 11.5 }}>— click a row for the stage breakdown</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={th}>Temple</th>
                {METHOD_ORDER.map((mk) => (
                  <th key={mk} style={{ ...th, color: METHOD_THEME[mk].fg }}>{METHOD_THEME[mk].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {temples.map((row) => {
                const open = openTemple === row.temple;
                return (
                  <FragmentRow
                    key={row.temple}
                    row={row}
                    open={open}
                    onToggle={() => setOpenTemple(open ? null : row.temple)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. Undecided queue + quick-tag ── */}
      <section style={{ background: "var(--surface)", border: "2px solid var(--gold-border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>
            ❓ Undecided (Nil) — {fmt0(undecided.length)} slab{undecided.length === 1 ? "" : "s"} waiting for a route
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Tick slabs → set CNC / Outsource / No carving below. This is the pile that used to live in Mohit&apos;s head.
          </div>
        </div>
        {undecidedByTemple.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>
            Nothing undecided — every active slab has a route. 🎉
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {undecidedByTemple.map(([temple, rows]) => {
              const open = openUndTemples.has(temple);
              const tickedHere = rows.filter((r) => selected.has(r.id)).length;
              return (
                <div key={temple} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenUndTemples((prev) => {
                        const next = new Set(prev);
                        if (next.has(temple)) next.delete(temple);
                        else next.add(temple);
                        return next;
                      })
                    }
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 750, fontSize: 12.5 }}>
                      {open ? "▼" : "▶"} {temple}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                      {rows.length} undecided{tickedHere > 0 ? ` · ${tickedHere} ticked` : ""}
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: "0 16px 12px" }}>
                      <button
                        type="button"
                        onClick={() => toggleTempleAll(rows)}
                        style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer", padding: "2px 0 8px" }}
                      >
                        {rows.every((r) => selected.has(r.id)) ? "Untick all in this temple" : `Tick all ${rows.length}`}
                      </button>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
                        {rows.map((s) => {
                          const on = selected.has(s.id);
                          return (
                            <label
                              key={s.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 8,
                                border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`,
                                background: on ? "rgba(180,140,40,0.08)" : "var(--bg)",
                                borderRadius: 8, padding: "7px 10px", cursor: "pointer",
                              }}
                            >
                              <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ cursor: "pointer" }} />
                              <span style={{ minWidth: 0 }}>
                                <span style={{ display: "block", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {s.priority && "⚡ "}{s.id}
                                </span>
                                <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {s.label || "—"} · {s.l}×{s.w}×{s.t}″ · {s.status.replace(/_/g, " ")}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {(msg || err) && (
        <div style={{ fontSize: 13, fontWeight: 700, color: err ? "#991b1b" : "#15803d" }}>{err ?? msg}</div>
      )}

      {/* Sticky quick-tag bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: "fixed", left: "var(--content-left)", right: 0, bottom: 0, zIndex: 60,
            background: "var(--surface)", borderTop: "2px solid var(--gold)",
            padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10, flexWrap: "wrap", boxShadow: "0 -4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 800 }}>
            {selected.size} slab{selected.size === 1 ? "" : "s"} selected — set carving method:
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["cnc", "outsource", "none"] as CarvingMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={pending}
                onClick={() => applyMethod(m)}
                style={{
                  padding: "9px 16px", fontSize: 13, fontWeight: 800, borderRadius: 8,
                  border: `1.5px solid ${METHOD_BADGE[m].border}`,
                  background: METHOD_BADGE[m].bg, color: METHOD_BADGE[m].fg,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {methodLabel(m)}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={() => setSelected(new Set())}
              className="ghost-button"
              style={{ fontSize: 12.5 }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
  color: "var(--muted)", textAlign: "left", padding: "8px 14px", whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "8px 14px", fontSize: 12.5, verticalAlign: "top" };

/** One matrix row + its expandable per-stage breakdown. Module-level so it
 *  never remounts on parent re-render (the known focus/state trap). */
function FragmentRow({ row, open, onToggle }: { row: TempleMethodRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: open ? "rgba(180,140,40,0.05)" : undefined }}
      >
        <td style={{ ...td, fontWeight: 750 }}>{open ? "▼" : "▶"} {row.temple}</td>
        {METHOD_ORDER.map((mk) => {
          const m = row.methods[mk];
          const done = m.stages.done.slabs;
          return (
            <td key={mk} style={td}>
              {m.total.slabs === 0 ? (
                <span style={{ color: "var(--muted-light)" }}>—</span>
              ) : (
                <span title={`${m.total.cft.toFixed(1)} CFT`}>
                  <b>{done}/{m.total.slabs}</b>
                  <span style={{ color: "var(--muted)", fontSize: 11 }}> · {Math.round(m.total.cft).toLocaleString("en-IN")} CFT</span>
                </span>
              )}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
          <td style={{ ...td, color: "var(--muted)", fontSize: 11.5 }}>Stage breakdown</td>
          {METHOD_ORDER.map((mk) => {
            const m = row.methods[mk];
            return (
              <td key={mk} style={td}>
                {m.total.slabs === 0 ? (
                  <span style={{ color: "var(--muted-light)" }}>—</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11 }}>
                    <span>Not cut: <b>{m.stages.notCut.slabs}</b></span>
                    <span>Cut · waiting: <b>{m.stages.cutWaiting.slabs}</b></span>
                    <span>In carving: <b>{m.stages.inCarving.slabs}</b></span>
                    <span>Done: <b>{m.stages.done.slabs}</b></span>
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      )}
    </>
  );
}
