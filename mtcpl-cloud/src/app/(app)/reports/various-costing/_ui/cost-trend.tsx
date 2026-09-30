"use client";

/**
 * The trend card on both Various-Costing pages (CNC and Cutter). One card,
 * two views, three granularities.
 *
 *   OUTPUT  — what the plant produced each window (CNC: SFT+CFT combined,
 *             Cutter: CFT), as an area chart.
 *   COST    — where the money went: expenses and depreciation stacked to the
 *             window's total cost, with the ₹/unit line over the top.
 *
 * Daksh, Sep 2026: "make it good, this doesn't look good… and give a toggle
 * between this output trend and a new one — in cost show a graph of the cost
 * split e.g. expenses, depreciation."
 *
 * ── Why the output chart changed shape ──────────────────────────────
 *
 * It used to BREAK the line on a window with no output and print a "×" on the
 * baseline, which shattered a 16-day daily view into disconnected fragments —
 * that is what looked broken. A day with nothing approved produced nothing;
 * zero is the honest value, and a continuous line through it reads as the
 * rhythm of the floor instead of as a rendering fault.
 *
 * The one window that must NOT be drawn as a flat zero is the last one, which
 * is still running (today / this week / this month to date). A partial window
 * plotted like a finished one reads as a collapse. Its segment is dashed and
 * its dot hollow, the universal "not finished" convention.
 *
 * ── Why ₹/unit rides on the cost chart ──────────────────────────────
 *
 * Stacked cost alone cannot answer the question the page exists for. Cost goes
 * up when you run more machines, which is not news. Cost ÷ output is the thing
 * that says whether the money bought anything, so it is drawn on its own right
 * axis over the bars. Where a window carved nothing the rate is undefined, not
 * zero, so the line genuinely breaks there — unlike output, where zero is real.
 *
 * Every figure comes from /api/reports/cost-trend, which runs the SAME engine
 * as the page headline, so the card can never disagree with the cards above it.
 * One fetch per granularity feeds both views; switching view costs nothing.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type Granularity = "daily" | "weekly" | "monthly";
type Mode = "output" | "cost";
type Cat = { key: string; label: string; amount: number };
type TrendPoint = {
  label: string; sub: string; startDate: string; endDate: string;
  value: number | null; cost: number; operational: number; depreciation: number;
  cats: Cat[]; out: number; slabs: number; days: number;
};
type ApiOk = { ok: true; plant: string; granularity: Granularity; unit: string; points: TrendPoint[] };

const fmtN = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
/** Money in the shape an Indian office reads it — an axis of "1519698" is
 *  noise, "₹15.2L" is a number somebody can hold in their head.
 *
 *  It keeps a decimal wherever rounding would MOVE the tick: a ₹1,500 gridline
 *  printed as "₹2k" made an evenly-spaced axis read 0 / 500 / 1k / 2k, which
 *  looks non-linear and is simply the wrong number. Trailing zeros are dropped
 *  so the common case stays short ("₹30L", not "₹30.00L"). */
function inrShort(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number, d: number) => {
    const t = x.toFixed(d);
    return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
  };
  if (a >= 1e7) return `₹${trim(n / 1e7, 2)}Cr`;
  if (a >= 1e5) return `₹${trim(n / 1e5, 2)}L`;
  if (a >= 1e3) return `₹${trim(n / 1e3, 1)}k`;
  return `₹${Math.round(n)}`;
}
const inrFull = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** Axis ticks on round numbers (1 / 2 / 2.5 / 5 × 10ⁿ). A scale that reads
 *  "855, 641.9, 428.7, 215.6, 2.4" makes the reader do arithmetic to place a
 *  point; "0, 200, 400, 600, 800" does not. Returns ticks from 0 up to at or
 *  just past `max`, and the caller uses the last one as the domain top. */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = 0, guard = 0; guard < 40; v += step, guard++) {
    out.push(v);
    if (v >= max - step * 1e-9) break;
  }
  return out.length > 1 ? out : [0, step];
}

const G_META: Record<Granularity, { label: string; caption: string; unitWord: string }> = {
  daily: { label: "Daily", caption: "each of the last 16 days", unitWord: "day" },
  weekly: { label: "Weekly", caption: "each of the last 8 weeks (Mon–Sun)", unitWord: "week" },
  monthly: { label: "Monthly", caption: "each of the last 6 months", unitWord: "month" },
};

/* Expenses carry the page's own gold; depreciation gets a cool slate so the
   two halves of the stack separate at a glance. The ₹/unit line is teal — a
   third identity, owing nothing to either bar.
 
   They are CSS variables, not constants, because a teal picked for contrast on
   white paper goes muddy on the dark theme's #1A1611 — the right-hand ₹/unit
   axis in particular became barely legible. Dark mode lifts the slate and the
   teal; the gold is the brand's own and carries over unchanged. */
const C_EXP = "var(--ct-exp)";
const C_DEP = "var(--ct-dep)";
const C_RATE = "var(--ct-rate)";
const SERIES_CSS = `
.vc-trend { --ct-exp:#C9973A; --ct-dep:#8091A7; --ct-rate:#0E7490; }
[data-theme="dark"] .vc-trend { --ct-dep:#9FB0C4; --ct-rate:#2DD4BF; }
`;

export function CostTrend({ plant }: { plant: "cnc" | "cutter" }) {
  const [g, setG] = useState<Granularity>("daily");
  const [mode, setMode] = useState<Mode>("output");
  const [cache, setCache] = useState<Partial<Record<Granularity, TrendPoint[]>>>({});
  const outUnit = plant === "cnc" ? "units (SFT+CFT)" : "CFT";
  const rateUnit = plant === "cnc" ? "₹/unit" : "₹/CFT";
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Hover tooltip — a custom div, because native SVG <title> is slow and
  // fires unreliably (Daksh: "not working"). px/py sit inside the wrapper.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  function showTip(i: number, ev: React.MouseEvent) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ i, px: ev.clientX - r.left, py: ev.clientY - r.top });
  }

  useEffect(() => {
    setHover(null); // a stale index would point into the wrong series
    if (cache[g]) return;
    let dead = false;
    setError(null);
    fetch(`/api/reports/cost-trend?plant=${plant}&granularity=${g}`)
      .then(async (res) => {
        const j = (await res.json()) as ApiOk | { ok: false; error: string };
        if (dead) return;
        if (!j.ok) { setError(j.error || "Failed to load the trend."); return; }
        setCache((p) => ({ ...p, [g]: j.points }));
      })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : String(e)); })
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, plant, tick]);

  const points = useMemo(() => cache[g] ?? [], [cache, g]);
  const n = points.length;
  /** The last window is always still running — today, this week, this month
   *  to date. Drawn as "in progress", never as a finished low reading. */
  const partialIdx = n - 1;

  const hasOutput = points.some((p) => p.out > 0);
  const hasCost = points.some((p) => p.cost > 0);
  const hasData = mode === "output" ? hasOutput : hasCost;

  // ── Geometry ───────────────────────────────────────────────────
  // MT leaves headroom for the right axis's unit caption, which otherwise
  // sits on top of its own highest tick label.
  const W = 880, H = 336, ML = 66, MT = 30, MB = 48;
  const MR = mode === "cost" ? 64 : 24;
  const IW = W - ML - MR, IH = H - MT - MB;

  const outVals = points.map((p) => (Number.isFinite(p.out) ? p.out : 0));
  const costVals = points.map((p) => (Number.isFinite(p.cost) ? p.cost : 0));
  // With the two cost series drawn side by side rather than stacked, the axis
  // only has to reach the taller of them — stacking needed room for the sum,
  // which squashed both lines into the bottom half.
  const leftMax = mode === "output"
    ? Math.max(...outVals, 0)
    : Math.max(0, ...points.map((p) => Math.max(p.operational || 0, p.depreciation || 0)));
  const ticks = niceTicks(leftMax || 1);
  const yTop = ticks[ticks.length - 1] || 1;
  const yAt = (v: number) => MT + IH - (IH * v) / yTop;

  // Right axis (cost view only) — the ₹/unit rate.
  const rateVals = points.map((p) => p.value).filter((v): v is number => v != null && Number.isFinite(v));
  const rTicks = niceTicks(rateVals.length ? Math.max(...rateVals) : 1);
  const rTop = rTicks[rTicks.length - 1] || 1;
  const rAt = (v: number) => MT + IH - (IH * v) / rTop;

  const xAt = (i: number) => ML + (n <= 1 ? IW / 2 : (IW * i) / (n - 1));
  const band = n > 1 ? IW / (n - 1) : IW;

  // Area + line path for the output view. Zeros are plotted, so the line is
  // continuous; the final (running) window is split off to be dashed.
  const linePts = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(Math.max(0, p.out)).toFixed(1)}`);
  const solidLine = linePts.slice(0, Math.max(2, n - 1)).join(" ");
  const tailLine = n >= 2 ? linePts.slice(n - 2).join(" ") : "";
  const areaPath = n
    ? `M ${xAt(0).toFixed(1)},${(MT + IH).toFixed(1)} L ${linePts.join(" L ")} L ${xAt(n - 1).toFixed(1)},${(MT + IH).toFixed(1)} Z`
    : "";

  const outAvg = outVals.length ? outVals.reduce((a, b) => a + b, 0) / outVals.length : 0;
  /** Last window that actually produced — "Latest 0" on a day that has barely
   *  started reads as a collapse, not as "nothing approved yet". */
  const lastOutIdx = (() => { for (let i = n - 1; i >= 0; i--) if (outVals[i] > 0) return i; return -1; })();
  const zeroWindows = outVals.filter((v) => !(v > 0)).length;
  const totalCost = costVals.reduce((a, b) => a + b, 0);
  const totalOp = points.reduce((a, p) => a + (p.operational || 0), 0);
  const totalDep = points.reduce((a, p) => a + (p.depreciation || 0), 0);
  const totalOut = outVals.reduce((a, b) => a + b, 0);

  // Thin the x labels so a 16-point daily axis does not collide with itself.
  const showLabel = (i: number) => n <= 9 || i % 2 === (n - 1) % 2;

  const seg = (active: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 800, padding: "7px 15px", borderRadius: 8, cursor: "pointer",
    border: "none", background: active ? "var(--gold)" : "transparent",
    color: active ? "#fff" : "var(--muted)", whiteSpace: "nowrap",
  });
  const gid = `ct-${plant}`;

  return (
    <div className="vc-trend" style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", marginBottom: 16 }}>
      <style>{SERIES_CSS}</style>
      {/* ── Header: title + the two toggles ─────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>
            {mode === "output" ? "📈 Output — trend" : "💰 Cost — where it goes"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>
            {mode === "output"
              ? `${G_META[g].caption} · ${plant === "cnc" ? "SFT + CFT" : "CFT"}, counted at approval`
              : `${G_META[g].caption} · expenses vs depreciation, with ${rateUnit} over the top`}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", gap: 3, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button type="button" onClick={() => setMode("output")} style={seg(mode === "output")}>Output</button>
            <button type="button" onClick={() => setMode("cost")} style={seg(mode === "cost")}>Cost</button>
          </div>
          <div style={{ display: "inline-flex", gap: 3, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
            {(Object.keys(G_META) as Granularity[]).map((k) => (
              <button key={k} type="button" onClick={() => setG(k)} style={seg(g === k)}>{G_META[k].label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Not-yet-fetched counts as loading. Keying this on `loading` alone
          flashed "No output in this range yet" on the very first paint,
          before the effect had even started the request — which reads as a
          plant that produced nothing. */}
      {!cache[g] && !error ? (
        <div style={{ height: 240, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>
          Crunching {G_META[g].label.toLowerCase()} windows… (each point is a full report run)
        </div>
      ) : error && !cache[g] ? (
        <div style={{ height: 170, display: "grid", placeItems: "center", gap: 8, color: "#b91c1c", fontSize: 13 }}>
          <span>⚠ {error}</span>
          <button type="button" onClick={() => { setError(null); setCache((p) => { const c = { ...p }; delete c[g]; return c; }); setTick((t) => t + 1); }} style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Retry</button>
        </div>
      ) : !hasData ? (
        <div style={{ height: 170, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>
          {mode === "output"
            ? "No output in this range yet — points appear once there is production."
            : "No cost booked in this range yet."}
        </div>
      ) : (
        <>
          {/* ── Summary strip ─────────────────────────────────────── */}
          {mode === "output" ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "8px 0 2px", fontSize: 12 }}>
              <span style={{ fontWeight: 800, color: "var(--gold-dark)" }}>
                Latest {lastOutIdx >= 0 ? fmtN(outVals[lastOutIdx]) : "0"} <span style={{ fontWeight: 600, color: "var(--muted)" }}>{outUnit}</span>
                {lastOutIdx >= 0 && lastOutIdx !== partialIdx && (
                  <span style={{ fontWeight: 600, color: "var(--muted)" }}> ({points[lastOutIdx].label})</span>
                )}
                {lastOutIdx === partialIdx && <span style={{ fontWeight: 600, color: "var(--muted)" }}> so far</span>}
              </span>
              <span style={{ color: "var(--muted)" }}>Best <strong>{fmtN(Math.max(...outVals))}</strong></span>
              <span style={{ color: "var(--muted)" }}>Average <strong>{fmtN(outAvg)}</strong></span>
              <span style={{ color: "var(--muted)" }}>Total <strong>{fmtN(totalOut)}</strong></span>
              {zeroWindows > 0 && (
                <span style={{ color: "var(--muted)" }}>
                  <strong>{zeroWindows}</strong> {G_META[g].unitWord}{zeroWindows === 1 ? "" : "s"} with nothing approved
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", margin: "8px 0 2px", fontSize: 12 }}>
              <span style={{ fontWeight: 800, color: "var(--text)" }}>Total {inrFull(totalCost)}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                <i style={{ width: 16, height: 3, borderRadius: 2, background: C_EXP, display: "inline-block" }} />
                Expenses <strong style={{ color: "var(--text)" }}>{inrFull(totalOp)}</strong>
                <span style={{ opacity: 0.75 }}>({fmt0(totalCost > 0 ? (totalOp / totalCost) * 100 : 0)}%)</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                <i style={{ width: 16, height: 3, borderRadius: 2, background: C_DEP, display: "inline-block" }} />
                Depreciation <strong style={{ color: "var(--text)" }}>{inrFull(totalDep)}</strong>
                <span style={{ opacity: 0.75 }}>({fmt0(totalCost > 0 ? (totalDep / totalCost) * 100 : 0)}%)</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                <i style={{ width: 16, height: 3, borderRadius: 2, background: C_RATE, display: "inline-block" }} />
                {rateUnit} <strong style={{ color: "var(--text)" }}>{totalOut > 0 ? fmtN(totalCost / totalOut) : "—"}</strong>
                <span style={{ opacity: 0.75 }}>overall</span>
              </span>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <div ref={wrapRef} style={{ position: "relative", minWidth: 600 }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
                aria-label={mode === "output" ? "Output trend" : "Cost split trend"}>
                <defs>
                  <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Gridlines + left axis */}
                {ticks.map((v, k) => {
                  const yy = yAt(v);
                  return (
                    <g key={k}>
                      <line x1={ML} x2={W - MR} y1={yy} y2={yy}
                        stroke="var(--border)" strokeWidth={v === 0 ? 1.3 : 0.7} opacity={v === 0 ? 1 : 0.55} />
                      <text x={ML - 9} y={yy + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                        {mode === "output" ? fmt0(v) : inrShort(v)}
                      </text>
                    </g>
                  );
                })}

                {mode === "output" ? (
                  <>
                    {/* Area, then line. The final window is still running, so
                        its segment is dashed rather than read as a collapse. */}
                    <path d={areaPath} fill={`url(#${gid}-area)`} />
                    {solidLine && <polyline points={solidLine} fill="none" stroke="var(--gold-dark)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />}
                    {tailLine && <polyline points={tailLine} fill="none" stroke="var(--gold-dark)" strokeWidth={2.4} strokeDasharray="6 5" strokeLinecap="round" opacity={0.85} />}
                    <line x1={ML} x2={W - MR} y1={yAt(outAvg)} y2={yAt(outAvg)} stroke="var(--gold-dark)" strokeDasharray="4 6" strokeWidth={1} opacity={0.5} />
                    <text x={W - MR - 2} y={yAt(outAvg) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--gold-dark)" opacity={0.75}>avg {fmt0(outAvg)}</text>
                    {points.map((p, i) => {
                      const hovered = hover?.i === i;
                      const isPartial = i === partialIdx;
                      const zero = !(p.out > 0);
                      return (
                        <circle key={i} cx={xAt(i)} cy={yAt(Math.max(0, p.out))}
                          r={hovered ? 6 : isPartial ? 5 : zero ? 2.6 : 3.4}
                          fill={hovered ? "var(--gold-dark)" : isPartial || zero ? "var(--surface)" : "var(--gold-dark)"}
                          stroke="var(--gold-dark)" strokeWidth={2} opacity={zero && !hovered ? 0.7 : 1} pointerEvents="none" />
                      );
                    })}
                  </>
                ) : (
                  <>
                    {/* Daksh, Sep 2026: "don't show this cost graph this way,
                        instead show 2 lines — cost of depreciation and
                        expenses." Two plain lines on the money axis; the
                        stack is gone, so the two are compared against each
                        other rather than read as one pile. Same dashed-tail
                        convention as the output chart for the window that is
                        still running. */}
                    {([
                      { get: (p: TrendPoint) => p.operational || 0, color: C_EXP, key: "exp" },
                      { get: (p: TrendPoint) => p.depreciation || 0, color: C_DEP, key: "dep" },
                    ] as const).map(({ get, color, key }) => {
                      const pts = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(Math.max(0, get(p))).toFixed(1)}`);
                      const solid = pts.slice(0, Math.max(2, n - 1)).join(" ");
                      const tail = n >= 2 ? pts.slice(n - 2).join(" ") : "";
                      return (
                        <g key={key}>
                          {solid && <polyline points={solid} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />}
                          {tail && <polyline points={tail} fill="none" stroke={color} strokeWidth={2.4} strokeDasharray="6 5" strokeLinecap="round" opacity={0.85} />}
                          {points.map((p, i) => (
                            <circle key={i} cx={xAt(i)} cy={yAt(Math.max(0, get(p)))}
                              r={hover?.i === i ? 5.5 : i === partialIdx ? 4 : 3}
                              fill={i === partialIdx ? "var(--surface)" : color}
                              stroke={color} strokeWidth={2} pointerEvents="none" />
                          ))}
                        </g>
                      );
                    })}
                    {/* ₹/unit on its own right axis. A window that carved
                        nothing has NO rate (not a zero one), so it breaks. */}
                    {(() => {
                      const segs: string[] = [];
                      let cur: string[] = [];
                      points.forEach((p, i) => {
                        if (p.value == null || !Number.isFinite(p.value)) { if (cur.length > 1) segs.push(cur.join(" ")); cur = []; return; }
                        cur.push(`${xAt(i).toFixed(1)},${rAt(p.value).toFixed(1)}`);
                      });
                      if (cur.length > 1) segs.push(cur.join(" "));
                      return segs.map((sp, k) => (
                        <polyline key={k} points={sp} fill="none" stroke={C_RATE} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                      ));
                    })()}
                    {points.map((p, i) => (p.value != null && Number.isFinite(p.value) ? (
                      <circle key={i} cx={xAt(i)} cy={rAt(p.value)} r={hover?.i === i ? 5.5 : 3}
                        fill="var(--surface)" stroke={C_RATE} strokeWidth={2} pointerEvents="none" />
                    ) : null))}
                    {/* Right axis */}
                    {rTicks.map((v, k) => (
                      <text key={k} x={W - MR + 9} y={rAt(v) + 3.5} textAnchor="start" fontSize="10" fill={C_RATE} opacity={0.85} fontFamily="ui-monospace, monospace">
                        {inrShort(v)}
                      </text>
                    ))}
                    <text x={W - MR + 9} y={MT - 13} textAnchor="start" fontSize="9" fontWeight="800" fill={C_RATE} opacity={0.9}>{rateUnit}</text>
                  </>
                )}

                {/* Hover crosshair — drawn above the series, under the labels. */}
                {hover && points[hover.i] && (
                  <line x1={xAt(hover.i)} x2={xAt(hover.i)} y1={MT} y2={MT + IH} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} pointerEvents="none" />
                )}

                {/* X labels + full-height hit columns (a big target beats a
                    3px dot on a laptop trackpad). */}
                {points.map((p, i) => (
                  <g key={i}>
                    {showLabel(i) && (
                      <text x={xAt(i)} y={H - MB + 18} textAnchor="middle" fontSize="9.5"
                        fill={i === partialIdx ? "var(--gold-dark)" : "var(--muted)"}
                        fontWeight={i === partialIdx ? 800 : 400}>{p.label}</text>
                    )}
                    <rect x={xAt(i) - band / 2} y={MT} width={band} height={IH} fill="transparent"
                      style={{ cursor: "crosshair" }}
                      onMouseMove={(ev) => showTip(i, ev)}
                      onMouseLeave={() => setHover(null)} />
                  </g>
                ))}
              </svg>

              {/* ── Tooltip ─────────────────────────────────────────── */}
              {hover && points[hover.i] && (() => {
                const p = points[hover.i];
                const w = wrapRef.current?.clientWidth ?? 600;
                const left = Math.min(Math.max(hover.px, 110), w - 110);
                const flipDown = hover.py < 130;
                const running = hover.i === partialIdx;
                return (
                  <div style={{ position: "absolute", left, top: hover.py + (flipDown ? 16 : -14), transform: `translate(-50%, ${flipDown ? "0" : "-100%"})`, pointerEvents: "none", zIndex: 5, background: "rgba(15,23,42,0.95)", color: "#fff", borderRadius: 10, padding: "10px 13px", boxShadow: "0 12px 30px rgba(0,0,0,0.32)", minWidth: 196, maxWidth: 270 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 5 }}>
                      {p.label}{running ? <span style={{ fontWeight: 600, color: "#fbbf24" }}> · still running</span> : null}
                    </div>

                    {mode === "output" ? (
                      <>
                        {p.out > 0 ? (
                          <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#fbbf24" }}>
                            {fmtN(p.out)} <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{outUnit}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Nothing approved this {G_META[g].unitWord}</div>
                        )}
                        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", marginTop: 5, lineHeight: 1.55 }}>
                          {p.slabs} slab{p.slabs === 1 ? "" : "s"} · {p.days} day{p.days === 1 ? "" : "s"} · cost {inrFull(p.cost)}
                          {p.out > 0 && p.value != null ? <><br />{fmtN(p.value)} {rateUnit}</> : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{inrFull(p.cost)}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "3px 8px", alignItems: "center", fontSize: 11, marginTop: 6 }}>
                          <i style={{ width: 13, height: 3, borderRadius: 2, background: C_EXP }} />
                          <span style={{ color: "rgba(255,255,255,0.8)" }}>Expenses</span>
                          <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inrFull(p.operational)}</strong>
                          <i style={{ width: 13, height: 3, borderRadius: 2, background: C_DEP }} />
                          <span style={{ color: "rgba(255,255,255,0.8)" }}>Depreciation</span>
                          <strong style={{ fontFamily: "ui-monospace, monospace" }}>{inrFull(p.depreciation)}</strong>
                        </div>
                        {p.cats.length > 0 && (
                          <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid rgba(255,255,255,0.16)", fontSize: 10.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
                            {p.cats.slice(0, 5).map((c) => (
                              <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <span>{c.label}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{inrFull(c.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid rgba(255,255,255,0.16)", fontSize: 10.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>
                          {p.value != null && Number.isFinite(p.value)
                            ? <><span style={{ color: "#5EEAD4", fontWeight: 800 }}>{fmtN(p.value)} {rateUnit}</span> · {fmtN(p.out)} {plant === "cnc" ? "units" : "CFT"} · {p.slabs} slab{p.slabs === 1 ? "" : "s"}</>
                            : <>No output this {G_META[g].unitWord} — cost still runs, so there is no rate to show.</>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
            {mode === "output" ? (
              <>Each point = that {G_META[g].unitWord}&apos;s own carved output, counted at approval. A {G_META[g].unitWord} with nothing approved sits on zero.</>
            ) : (
              <>Two lines on the money axis: what was SPENT and what was WRITTEN OFF in that {G_META[g].unitWord}; add them for the total. The teal line is {rateUnit} on the right axis, and it breaks where nothing was carved.</>
            )}
            {" "}The last {G_META[g].unitWord} is still running (dashed / lighter top). Hover anywhere on a column for the full breakdown.
          </div>
        </>
      )}
    </div>
  );
}
