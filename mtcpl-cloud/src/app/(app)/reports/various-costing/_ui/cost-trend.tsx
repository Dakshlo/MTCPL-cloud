"use client";

/**
 * Output trend graph (Daksh, Jul 2026) — shared by the CNC and Cutter
 * Various-Costing pages. Plots carved OUTPUT per period (CNC: SFT+CFT combined,
 * Cutter: CFT). Three granularities:
 *   • Daily   — each of the last 16 days' own output.
 *   • Weekly  — each of the last 8 weeks' output (Mon–Sun).
 *   • Monthly — each of the last 6 months' output (current = month-to-date).
 *
 * Every point comes from /api/reports/cost-trend, which runs the SAME report
 * engine as the page headline — the graph can never disagree with the Output
 * cards. Each point also carries its cost (shown in the hover tooltip). Series
 * are fetched lazily per granularity and cached client-side.
 */

import { useEffect, useRef, useState } from "react";

type Granularity = "daily" | "weekly" | "monthly";
type TrendPoint = {
  label: string; sub: string; startDate: string; endDate: string;
  value: number | null; cost: number; out: number; slabs: number; days: number;
};
type ApiOk = { ok: true; plant: string; granularity: Granularity; unit: string; points: TrendPoint[] };

const fmtN = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

const G_META: Record<Granularity, { label: string; caption: string }> = {
  daily: { label: "Daily", caption: "output each day (last 16 days)" },
  weekly: { label: "Weekly", caption: "each week's output (Mon–Sun)" },
  monthly: { label: "Monthly", caption: "each month's output (current = MTD)" },
};

export function CostTrend({ plant }: { plant: "cnc" | "cutter" }) {
  const [g, setG] = useState<Granularity>("daily");
  const [cache, setCache] = useState<Partial<Record<Granularity, TrendPoint[]>>>({});
  // Output unit for this plant (CNC counts combined SFT+CFT; Cutter counts CFT).
  const outUnit = plant === "cnc" ? "units (SFT+CFT)" : "CFT";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to retry after an error
  // Hover tooltip — custom div (native SVG <title> is slow/flaky, Daksh: "not
  // working"). px/py are positions inside the chart wrapper.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  function showTip(i: number, ev: React.MouseEvent) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ i, px: ev.clientX - r.left, py: ev.clientY - r.top });
  }

  useEffect(() => {
    setHover(null); // stale index would point at the wrong granularity's dot
    if (cache[g]) return;
    let dead = false;
    setLoading(true);
    setError(null);
    fetch(`/api/reports/cost-trend?plant=${plant}&granularity=${g}`)
      .then(async (res) => {
        const j = (await res.json()) as ApiOk | { ok: false; error: string };
        if (dead) return;
        if (!j.ok) { setError(j.error || "Failed to load the trend."); return; }
        setCache((p) => ({ ...p, [g]: j.points }));
      })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, plant, tick]);

  const points = cache[g] ?? [];
  // The plotted metric is OUTPUT; a window with no output is a gap (×), not 0.
  const plotOf = (p: TrendPoint): number | null => (p.out > 0 && Number.isFinite(p.out) ? p.out : null);
  const vals = points.map(plotOf).filter((v): v is number => v != null);
  const hasData = vals.length > 0;

  const seg = (active: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 800, padding: "7px 16px", borderRadius: 9, cursor: "pointer",
    border: "none", background: active ? "var(--gold)" : "transparent", color: active ? "#fff" : "var(--muted)",
  });

  // ── Chart geometry ─────────────────────────────────────────────
  const W = 760, H = 300, ML = 64, MR = 18, MT = 26, MB = 44;
  const IW = W - ML - MR, IH = H - MT - MB;
  const lo = hasData ? Math.min(...vals) : 0;
  const hi = hasData ? Math.max(...vals) : 1;
  const padDomain = hi === lo ? Math.max(1, hi * 0.15) : (hi - lo) * 0.18;
  const y0 = Math.max(0, lo - padDomain), y1 = hi + padDomain;
  const xAt = (i: number) => ML + (points.length <= 1 ? IW / 2 : (IW * i) / (points.length - 1));
  const yAt = (v: number) => MT + IH - (IH * (v - y0)) / (y1 - y0 || 1);

  // Polyline segments — a null point breaks the line (gap), not bridges it.
  const segments: string[] = [];
  {
    let cur: string[] = [];
    points.forEach((p, i) => {
      const v = plotOf(p);
      if (v == null) { if (cur.length > 1) segments.push(cur.join(" ")); cur = []; return; }
      cur.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    });
    if (cur.length > 1) segments.push(cur.join(" "));
  }
  const lastIdx = (() => { for (let i = points.length - 1; i >= 0; i--) if (plotOf(points[i]) != null) return i; return -1; })();
  const avg = hasData ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  // Thin labels when daily (16 points) so the x-axis stays readable.
  const showLabel = (i: number) => points.length <= 9 || i % 2 === (points.length - 1) % 2 || i === lastIdx;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>📈 Output — trend</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{G_META[g].caption} · {plant === "cnc" ? "SFT + CFT" : "CFT"}, counted at carving approval</div>
        </div>
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)" }}>
          {(Object.keys(G_META) as Granularity[]).map((k) => (
            <button key={k} type="button" onClick={() => setG(k)} style={seg(g === k)}>{G_META[k].label}</button>
          ))}
        </div>
      </div>

      {loading && !cache[g] ? (
        <div style={{ height: 220, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>
          Crunching {G_META[g].label.toLowerCase()} windows… (each point is a full report run)
        </div>
      ) : error && !cache[g] ? (
        <div style={{ height: 160, display: "grid", placeItems: "center", gap: 8, color: "#b91c1c", fontSize: 13 }}>
          <span>⚠ {error}</span>
          <button type="button" onClick={() => { setError(null); setCache((p) => { const n = { ...p }; delete n[g]; return n; }); setTick((t) => t + 1); }} style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Retry</button>
        </div>
      ) : !hasData ? (
        <div style={{ height: 160, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>No output in this range yet — points appear once there is production.</div>
      ) : (
        <>
          {/* Summary strip */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "8px 0 4px", fontSize: 12 }}>
            <span style={{ fontWeight: 800, color: "var(--gold-dark)" }}>Latest {lastIdx >= 0 && points[lastIdx].out > 0 ? fmtN(points[lastIdx].out) : "—"} <span style={{ fontWeight: 600, color: "var(--muted)" }}>{outUnit}</span></span>
            <span style={{ color: "var(--muted)" }}>Low <strong>{fmtN(Math.min(...vals))}</strong></span>
            <span style={{ color: "var(--muted)" }}>High <strong>{fmtN(Math.max(...vals))}</strong></span>
            <span style={{ color: "var(--muted)" }}>Average <strong>{fmtN(avg)}</strong></span>
            <span style={{ color: "var(--muted)" }}>Total <strong>{fmtN(vals.reduce((a, b) => a + b, 0))}</strong></span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <div ref={wrapRef} style={{ position: "relative", minWidth: 560 }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Output trend">
              {/* gridlines + y labels */}
              {[0, 1, 2, 3, 4].map((k) => {
                const v = y0 + ((y1 - y0) * k) / 4;
                const yy = yAt(v);
                return (
                  <g key={k}>
                    <line x1={ML} x2={W - MR} y1={yy} y2={yy} stroke="var(--border)" strokeWidth={k === 0 ? 1.2 : 0.6} opacity={k === 0 ? 1 : 0.7} />
                    <text x={ML - 8} y={yy + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="ui-monospace, monospace">{fmtN(v)}</text>
                  </g>
                );
              })}
              {/* average dashed line */}
              <line x1={ML} x2={W - MR} y1={yAt(avg)} y2={yAt(avg)} stroke="var(--gold-dark)" strokeDasharray="5 5" strokeWidth={1} opacity={0.55} />
              {/* line segments */}
              {segments.map((s, i) => (
                <polyline key={i} points={s} fill="none" stroke="var(--gold-dark)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {/* dots + x labels */}
              {points.map((p, i) => {
                const x = xAt(i);
                const isLast = i === lastIdx;
                const hovered = hover?.i === i;
                return (
                  <g key={i}>
                    {p.out > 0 && Number.isFinite(p.out) ? (
                      <>
                        <circle cx={x} cy={yAt(p.out)} r={hovered ? 6 : isLast ? 5 : 3.2} fill={isLast || hovered ? "var(--gold-dark)" : "var(--surface)"} stroke="var(--gold-dark)" strokeWidth={2} pointerEvents="none" />
                        {isLast && !hovered && (
                          <text x={Math.min(x, W - MR - 30)} y={yAt(p.out) - 10} textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--gold-dark)" fontFamily="ui-monospace, monospace">{fmtN(p.out)}</text>
                        )}
                      </>
                    ) : (
                      <text x={x} y={MT + IH - 4} textAnchor="middle" fontSize="9" fill="var(--muted)" opacity={0.8} pointerEvents="none">×</text>
                    )}
                    {showLabel(i) && (
                      <text x={x} y={H - MB + 16} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{p.label}</text>
                    )}
                    {/* BIG invisible hit area — reliable hover (native SVG
                        <title> tooltips were flaky). Covers the dot AND its
                        full column strip so it's easy to hit. */}
                    <rect
                      x={x - (points.length > 1 ? (IW / (points.length - 1)) / 2 : IW / 2)}
                      y={MT}
                      width={points.length > 1 ? IW / (points.length - 1) : IW}
                      height={IH}
                      fill="transparent"
                      style={{ cursor: "crosshair" }}
                      onMouseMove={(ev) => showTip(i, ev)}
                      onMouseLeave={() => setHover(null)}
                    />
                  </g>
                );
              })}
            </svg>
            {/* Custom tooltip */}
            {hover && points[hover.i] && (() => {
              const p = points[hover.i];
              const w = wrapRef.current?.clientWidth ?? 560;
              const left = Math.min(Math.max(hover.px, 90), w - 90);
              const flipDown = hover.py < 96;
              return (
                <div style={{ position: "absolute", left, top: hover.py + (flipDown ? 14 : -12), transform: `translate(-50%, ${flipDown ? "0" : "-100%"})`, pointerEvents: "none", zIndex: 5, background: "rgba(15,23,42,0.94)", color: "#fff", borderRadius: 10, padding: "9px 12px", boxShadow: "0 10px 28px rgba(0,0,0,0.3)", minWidth: 168, maxWidth: 240 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 3 }}>{p.label}</div>
                  {p.out > 0 && Number.isFinite(p.out) ? (
                    <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#fbbf24" }}>{fmtN(p.out)} <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{outUnit}</span></div>
                  ) : (
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>No output this window</div>
                  )}
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", marginTop: 4, lineHeight: 1.5 }}>
                    {p.slabs} slab{p.slabs === 1 ? "" : "s"} · {p.days} day{p.days === 1 ? "" : "s"} · cost ₹{fmtN(p.cost)}<br />
                    <span style={{ color: "rgba(255,255,255,0.55)" }}>{p.sub}</span>
                  </div>
                </div>
              );
            })()}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
            {g === "daily"
              ? "Each point = that day's own carved output, counted at approval."
              : g === "weekly"
              ? "Each point = that week's carved output (Mon–Sun)."
              : "Each point = that month's carved output (current month runs to today)."}
            {" "}Hover a dot for output, slabs, days and cost. × = no output in that window.
          </div>
        </>
      )}
    </div>
  );
}
