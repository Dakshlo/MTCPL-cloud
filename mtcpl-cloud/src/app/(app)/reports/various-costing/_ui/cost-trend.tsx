"use client";

/**
 * Cost-per-unit trend graph (Daksh, Jul 2026) — shared by the CNC and Cutter
 * Various-Costing pages. Three granularities:
 *   • Daily   — the headline cost/unit AS OF each of the last 16 days (the
 *               month-to-date elapsed-days number, evaluated day by day; going
 *               past the 1st shows last month's running curve).
 *   • Weekly  — each of the last 8 weeks' own cost (Mon–Sun).
 *   • Monthly — each of the last 6 months (current = month-to-date).
 *
 * Every point comes from /api/reports/cost-trend, which runs the SAME report
 * engine as the page headline — the graph can never disagree with the cards.
 * Series are fetched lazily per granularity and cached client-side.
 */

import { useEffect, useState } from "react";

type Granularity = "daily" | "weekly" | "monthly";
type TrendPoint = {
  label: string; sub: string; startDate: string; endDate: string;
  value: number | null; cost: number; out: number; slabs: number; days: number;
};
type ApiOk = { ok: true; plant: string; granularity: Granularity; unit: string; points: TrendPoint[] };

const fmtINR = (n: number) => `₹${n >= 100 ? Math.round(n).toLocaleString("en-IN") : n.toFixed(1)}`;
const fmtN = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

const G_META: Record<Granularity, { label: string; caption: string }> = {
  daily: { label: "Daily", caption: "cost/unit as of each day (month-to-date)" },
  weekly: { label: "Weekly", caption: "each week's own cost (Mon–Sun)" },
  monthly: { label: "Monthly", caption: "each month's cost (current = MTD)" },
};

export function CostTrend({ plant }: { plant: "cnc" | "cutter" }) {
  const [g, setG] = useState<Granularity>("daily");
  const [cache, setCache] = useState<Partial<Record<Granularity, TrendPoint[]>>>({});
  const [unit, setUnit] = useState(plant === "cnc" ? "per unit (SFT+CFT)" : "per CFT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to retry after an error

  useEffect(() => {
    if (cache[g]) return;
    let dead = false;
    setLoading(true);
    setError(null);
    fetch(`/api/reports/cost-trend?plant=${plant}&granularity=${g}`)
      .then(async (res) => {
        const j = (await res.json()) as ApiOk | { ok: false; error: string };
        if (dead) return;
        if (!j.ok) { setError(j.error || "Failed to load the trend."); return; }
        setUnit(j.unit);
        setCache((p) => ({ ...p, [g]: j.points }));
      })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, plant, tick]);

  const points = cache[g] ?? [];
  const vals = points.map((p) => p.value).filter((v): v is number => v != null && Number.isFinite(v));
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
      if (p.value == null || !Number.isFinite(p.value)) { if (cur.length > 1) segments.push(cur.join(" ")); cur = []; return; }
      cur.push(`${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`);
    });
    if (cur.length > 1) segments.push(cur.join(" "));
  }
  const lastIdx = (() => { for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) return i; return -1; })();
  const avg = hasData ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  // Thin labels when daily (16 points) so the x-axis stays readable.
  const showLabel = (i: number) => points.length <= 9 || i % 2 === (points.length - 1) % 2 || i === lastIdx;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>📈 Cost {plant === "cnc" ? "per unit" : "per CFT"} — trend</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{G_META[g].caption} · same calculation as the card above</div>
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
            <span style={{ fontWeight: 800, color: "var(--gold-dark)" }}>Latest {lastIdx >= 0 && points[lastIdx].value != null ? fmtINR(points[lastIdx].value as number) : "—"} <span style={{ fontWeight: 600, color: "var(--muted)" }}>{unit}</span></span>
            <span style={{ color: "var(--muted)" }}>Low <strong>{fmtINR(Math.min(...vals))}</strong></span>
            <span style={{ color: "var(--muted)" }}>High <strong>{fmtINR(Math.max(...vals))}</strong></span>
            <span style={{ color: "var(--muted)" }}>Average <strong>{fmtINR(avg)}</strong></span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, display: "block" }} role="img" aria-label="Cost per unit trend">
              {/* gridlines + y labels */}
              {[0, 1, 2, 3, 4].map((k) => {
                const v = y0 + ((y1 - y0) * k) / 4;
                const yy = yAt(v);
                return (
                  <g key={k}>
                    <line x1={ML} x2={W - MR} y1={yy} y2={yy} stroke="var(--border)" strokeWidth={k === 0 ? 1.2 : 0.6} opacity={k === 0 ? 1 : 0.7} />
                    <text x={ML - 8} y={yy + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="ui-monospace, monospace">{fmtINR(v)}</text>
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
                return (
                  <g key={i}>
                    {p.value != null && Number.isFinite(p.value) ? (
                      <>
                        <circle cx={x} cy={yAt(p.value)} r={isLast ? 5 : 3.2} fill={isLast ? "var(--gold-dark)" : "var(--surface)"} stroke="var(--gold-dark)" strokeWidth={2}>
                          <title>{`${p.label} — ${fmtINR(p.value)} ${unit}\nWindow: ${p.sub}\nCost ₹${fmtN(p.cost)} · Output ${fmtN(p.out)} · ${p.slabs} slabs · ${p.days} day${p.days === 1 ? "" : "s"}`}</title>
                        </circle>
                        {isLast && (
                          <text x={Math.min(x, W - MR - 30)} y={yAt(p.value) - 10} textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--gold-dark)" fontFamily="ui-monospace, monospace">{fmtINR(p.value)}</text>
                        )}
                      </>
                    ) : (
                      <text x={x} y={MT + IH - 4} textAnchor="middle" fontSize="9" fill="var(--muted)" opacity={0.8}>
                        ×<title>{`${p.label} — no output in this window`}</title>
                      </text>
                    )}
                    {showLabel(i) && (
                      <text x={x} y={H - MB + 16} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{p.label}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
            {g === "daily"
              ? "Each point = the COST PER UNIT card recalculated as of that day (expenses prorated to days elapsed ÷ output so far). Crossing the 1st shows last month's curve."
              : g === "weekly"
              ? "Each point = that week's own prorated cost ÷ that week's output."
              : "Each point = that month's cost ÷ that month's output (current month runs to today)."}
            {" "}Hover a dot for cost, output and days. × = no output that window.
          </div>
        </>
      )}
    </div>
  );
}
