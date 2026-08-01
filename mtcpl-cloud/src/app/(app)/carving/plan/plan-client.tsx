"use client";

// ──────────────────────────────────────────────────────────────────
// Carving Plan — client board (mig 215, reworked per Daksh):
//   1. Per-method headline cards.
//   2. ONE deep CNC-capacity card (outsource-pace + off-plan cards cut).
//   3. Temple section = pick a temple from a bold dropdown → a proper
//      route × stage table for just that temple (no all-temple wall).
//   4. Undecided queue — searchable (any slab field), grouped by
//      STATUS, richer cards (categories, stone, dims, temple), tick →
//      sticky set-method bar.
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
  stone: string | null; description: string | null;
  section: string | null; element: string | null;
  l: number; w: number; t: number; priority: boolean;
};
export type CncForecast = {
  machineCount: number;
  cncPending: Tot;
  cncDone30: Tot;
};

const METHOD_ORDER: MethodKey[] = ["cnc", "outsource", "none", "nil"];
const METHOD_THEME: Record<MethodKey, { label: string; fg: string }> = {
  cnc: { label: "CNC", fg: METHOD_BADGE.cnc.fg },
  outsource: { label: "Outsource", fg: METHOD_BADGE.outsource.fg },
  none: { label: "No carving", fg: METHOD_BADGE.none.fg },
  nil: { label: "Nil — undecided", fg: "#6b7280" },
};
const STAGE_LABELS: Array<{ key: keyof StageTotals; label: string }> = [
  { key: "notCut", label: "Not cut yet" },
  { key: "cutWaiting", label: "Cut · waiting" },
  { key: "inCarving", label: "In carving" },
  { key: "done", label: "Done" },
];
// Status-group order for the Undecided queue — most actionable first.
const STATUS_GROUPS: Array<{ key: string; label: string }> = [
  { key: "cut_done", label: "Cut · ready — needs a route now" },
  { key: "cutting", label: "Cutting on the machine" },
  { key: "planned", label: "Planned for cutting" },
  { key: "open", label: "Not cut yet" },
];

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cftOf = (s: UndecidedSlab) => (s.l * s.w * s.t) / 1728;

export function PlanClient({
  summaries, temples, undecided, forecast,
}: {
  summaries: Record<MethodKey, MethodSummary>;
  temples: TempleMethodRow[];
  undecided: UndecidedSlab[];
  forecast: CncForecast;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [temple, setTemple] = useState<string>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templeRow = temples.find((t) => t.temple === temple) ?? null;

  // ── Undecided: search across every slab field, then group by status.
  const filteredUndecided = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return undecided;
    return undecided.filter((s) => {
      const hay = [
        s.id, s.temple, s.label, s.stone, s.description, s.section, s.element,
        s.status.replace(/_/g, " "), `${s.l}x${s.w}x${s.t}`, `${s.l}×${s.w}×${s.t}`,
      ]
        .filter(Boolean)
        .join(" · ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [undecided, q]);

  const undecidedByStatus = useMemo(() => {
    const m = new Map<string, UndecidedSlab[]>();
    for (const s of filteredUndecided) {
      const arr = m.get(s.status) ?? [];
      arr.push(s);
      m.set(s.status, arr);
    }
    const known = STATUS_GROUPS.filter((g) => (m.get(g.key)?.length ?? 0) > 0).map((g) => ({
      ...g,
      rows: m.get(g.key)!,
    }));
    // Any status outside the known four (safety) tails the list.
    const extras = [...m.entries()]
      .filter(([k]) => !STATUS_GROUPS.some((g) => g.key === k))
      .map(([k, rows]) => ({ key: k, label: k.replace(/_/g, " "), rows }));
    return [...known, ...extras];
  }, [filteredUndecided]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleGroupAll(rows: UndecidedSlab[]) {
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

  // ── CNC forecast derived figures.
  const cftPerDay = forecast.cncDone30.cft / 30;
  const slabsPerDay = forecast.cncDone30.slabs / 30;
  const perMachineDay = forecast.machineCount > 0 ? cftPerDay / forecast.machineCount : 0;
  const daysLeft = cftPerDay > 0 ? forecast.cncPending.cft / cftPerDay : null;
  const clearDate =
    daysLeft != null
      ? new Date(Date.now() + daysLeft * 24 * 3600 * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : null;
  const undecidedCutReady = summaries.nil.stages.cutWaiting.slabs;

  const card: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 16px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 90 }}>
      <div className="page-header">
        <h1>Carving Plan</h1>
      </div>

      {/* ── 1. Per-method headline cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {METHOD_ORDER.map((mk) => {
          const s = summaries[mk];
          const th2 = METHOD_THEME[mk];
          const done = s.stages.done;
          return (
            <div key={mk} style={{ ...card, borderTop: `3px solid ${th2.fg}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: th2.fg }}>
                  {th2.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                  {pct(done.slabs, s.total.slabs)}% done
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
                {fmt0(s.total.slabs)} <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>slabs</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginLeft: 8 }}>{fmt0(s.total.cft)} CFT</span>
              </div>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden", margin: "8px 0 10px" }}>
                <div style={{ width: `${pct(done.slabs, s.total.slabs)}%`, height: "100%", background: th2.fg }} />
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

      {/* ── 2. CNC capacity — the one forecast card, deep ── */}
      <div style={{ ...card, borderLeft: "4px solid #1d4ed8", padding: "16px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#1d4ed8" }}>
          ⚙️ CNC capacity
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 24px", marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>Pending CNC work</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>
              {fmt0(forecast.cncPending.slabs)} <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>slabs</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginLeft: 7 }}>{fmt0(forecast.cncPending.cft)} CFT</span>
            </div>
            <table style={{ borderCollapse: "collapse", marginTop: 6 }}>
              <tbody>
                <tr><td style={miniTd}>Not cut yet</td><td style={miniTdV}>{fmt0(summaries.cnc.stages.notCut.slabs)}</td></tr>
                <tr><td style={miniTd}>Cut · waiting</td><td style={miniTdV}>{fmt0(summaries.cnc.stages.cutWaiting.slabs)}</td></tr>
                <tr><td style={miniTd}>On machines</td><td style={miniTdV}>{fmt0(summaries.cnc.stages.inCarving.slabs)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>Pace — last 30 days</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>
              {fmt1(cftPerDay)} <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>CFT/day</span>
            </div>
            <table style={{ borderCollapse: "collapse", marginTop: 6 }}>
              <tbody>
                <tr><td style={miniTd}>Approved</td><td style={miniTdV}>{fmt0(forecast.cncDone30.slabs)} slabs · {fmt0(forecast.cncDone30.cft)} CFT</td></tr>
                <tr><td style={miniTd}>Per day</td><td style={miniTdV}>{fmt1(slabsPerDay)} slabs</td></tr>
                <tr><td style={miniTd}>Per machine</td><td style={miniTdV}>{fmt1(perMachineDay)} CFT/day · {forecast.machineCount} machines</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 14.5, fontWeight: 800, color: daysLeft != null && daysLeft > 60 ? "#b91c1c" : "#15803d" }}>
          {daysLeft == null
            ? "No CNC approvals in the last 30 days — no pace to forecast from."
            : `≈ ${fmt0(daysLeft)} days of CNC work left — clears around ${clearDate}.`}
        </div>
        {daysLeft != null && daysLeft < 10 && undecidedCutReady > 0 && (
          <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: "#b45309" }}>
            ⚠ Machines run dry in under {fmt0(Math.max(1, daysLeft))} days — {fmt0(undecidedCutReady)} cut slabs below are still undecided; route some to CNC to keep them fed.
          </div>
        )}
        {daysLeft != null && daysLeft > 60 && (
          <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: "#b45309" }}>
            ⚠ Over {fmt1(daysLeft / 30)} months of CNC backlog — consider moving load to outsource.
          </div>
        )}
      </div>

      {/* ── 3. Temple-wise — pick first, then one clean table ── */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: templeRow ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>🏛 Temple-wise route load</span>
          <select
            value={temple}
            onChange={(e) => setTemple(e.target.value)}
            style={{
              padding: "10px 14px", fontSize: 13.5, fontWeight: 700, minWidth: 280,
              border: "2px solid var(--gold-border, #d8c49a)", borderRadius: 8,
              background: "var(--bg)", color: "var(--text)", cursor: "pointer",
            }}
          >
            <option value="">— Choose temple —</option>
            {temples.map((t) => {
              const total =
                t.methods.cnc.total.slabs + t.methods.outsource.total.slabs +
                t.methods.none.total.slabs + t.methods.nil.total.slabs;
              return (
                <option key={t.temple} value={t.temple}>
                  {t.temple} ({fmt0(total)} slabs)
                </option>
              );
            })}
          </select>
        </div>
        {templeRow && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
                  <th style={{ ...th, textAlign: "left" }}>Route</th>
                  <th style={th}>Not cut</th>
                  <th style={th}>Cut · waiting</th>
                  <th style={th}>In carving</th>
                  <th style={th}>Done</th>
                  <th style={th}>Total</th>
                  <th style={th}>CFT</th>
                  <th style={th}>% done</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ORDER.map((mk, i) => {
                  const m = templeRow.methods[mk];
                  if (m.total.slabs === 0) return null;
                  return (
                    <tr key={mk} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 1 ? "var(--surface-alt, rgba(0,0,0,0.02))" : undefined }}>
                      <td style={{ ...tdL, color: METHOD_THEME[mk].fg, fontWeight: 800 }}>{METHOD_THEME[mk].label}</td>
                      <td style={tdN}>{fmt0(m.stages.notCut.slabs)}</td>
                      <td style={tdN}>{fmt0(m.stages.cutWaiting.slabs)}</td>
                      <td style={tdN}>{fmt0(m.stages.inCarving.slabs)}</td>
                      <td style={tdN}>{fmt0(m.stages.done.slabs)}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(m.total.slabs)}</td>
                      <td style={tdN}>{fmt0(m.total.cft)}</td>
                      <td style={tdN}>{pct(m.stages.done.slabs, m.total.slabs)}%</td>
                    </tr>
                  );
                })}
                {(() => {
                  const sum = (f: (m: MethodSummary) => number) => METHOD_ORDER.reduce((a, mk) => a + f(templeRow.methods[mk]), 0);
                  return (
                    <tr style={{ borderTop: "2px solid var(--border)" }}>
                      <td style={{ ...tdL, fontWeight: 800 }}>TOTAL</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.stages.notCut.slabs))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.stages.cutWaiting.slabs))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.stages.inCarving.slabs))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.stages.done.slabs))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.total.slabs))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{fmt0(sum((m) => m.total.cft))}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{pct(sum((m) => m.stages.done.slabs), sum((m) => m.total.slabs))}%</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 4. Undecided queue — search + status groups + quick-tag ── */}
      <section style={{ background: "var(--surface)", border: "2px solid var(--gold-border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            ❓ Undecided — {fmt0(filteredUndecided.length)}{q ? ` of ${fmt0(undecided.length)}` : ""} slab{filteredUndecided.length === 1 ? "" : "s"}
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔎 Search code, temple, category, label, stone, size…"
            style={{
              flex: "1 1 320px", maxWidth: 460, padding: "9px 13px", fontSize: 13,
              border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)",
            }}
          />
        </div>
        {undecidedByStatus.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>
            {q ? "No undecided slabs match this search." : "Nothing undecided — every active slab has a route. 🎉"}
          </div>
        ) : (
          undecidedByStatus.map((g) => {
            const ticked = g.rows.filter((r) => selected.has(r.id)).length;
            const allIn = ticked === g.rows.length;
            return (
              <div key={g.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {g.label} · {fmt0(g.rows.length)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroupAll(g.rows)}
                    style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    {allIn ? "Untick all" : `Tick all ${fmt0(g.rows.length)}`}{ticked > 0 && !allIn ? ` (${ticked} ticked)` : ""}
                  </button>
                </div>
                <div style={{ padding: "10px 16px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {g.rows.map((s) => {
                    const on = selected.has(s.id);
                    const cats = [s.section, s.element].filter(Boolean).join(" › ");
                    return (
                      <label
                        key={s.id}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 9,
                          border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`,
                          background: on ? "rgba(180,140,40,0.08)" : "var(--bg)",
                          borderRadius: 6, padding: "9px 11px", cursor: "pointer",
                        }}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ cursor: "pointer", marginTop: 2 }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.priority && "⚡ "}{s.id}
                            </span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", flexShrink: 0 }}>
                              {s.l}×{s.w}×{s.t}″ · {fmt1(cftOf(s))} CFT
                            </span>
                          </span>
                          {cats && (
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {cats}
                            </span>
                          )}
                          <span style={{ display: "block", fontSize: 11, color: "var(--text)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[s.label, s.description].filter(Boolean).join(" — ") || "—"}
                          </span>
                          <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            🏛 {s.temple}{s.stone ? ` · ${s.stone}` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })
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
                  padding: "9px 16px", fontSize: 13, fontWeight: 800, borderRadius: 6,
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
  color: "var(--muted)", textAlign: "right", padding: "9px 14px", whiteSpace: "nowrap",
};
const tdL: React.CSSProperties = { padding: "9px 14px", fontSize: 12.5, textAlign: "left", whiteSpace: "nowrap" };
const tdN: React.CSSProperties = { padding: "9px 14px", fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const miniTd: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", padding: "1px 14px 1px 0" };
const miniTdV: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: "1px 0", fontVariantNumeric: "tabular-nums" };
