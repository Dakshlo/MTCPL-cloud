"use client";

/**
 * The number slide on the carving wall (Daksh, Sep 2026).
 *
 * This month's carved output climbing toward last month's finished
 * curve. Two lines on one chart, cumulative by day of month, so "ahead
 * or behind" is read off which line is higher at today's mark rather
 * than by comparing two months of different lengths.
 *
 * A Vendor Scoreboard slide lived here too — per-vendor bars against
 * each vendor's own same-day figure last month. Daksh dropped it after
 * a week on the wall: "keep carving this month, that one's good."
 * Deleted rather than left unrendered, along with the per-vendor
 * aggregation in floor-production-data that fed it.
 *
 * Drawn as inline SVG with no chart library: the wall runs an always-on
 * browser and every kilobyte of JS is a kilobyte that can fail to load
 * at 6 am with nobody there to reload it.
 *
 * Sized for a TV seen from across a workshop — the smallest type here
 * is 14px before TvFit scales the slide up to fill the screen.
 */

import type { FloorProduction, FloorStock, MonthSeries, ProductionPoint, StockStone } from "@/lib/floor-production-data";

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** How long the line takes to draw itself in on arrival. Comfortably
 *  inside the shortest sensible rotation so the slide is never still
 *  drawing when it is swapped out. */
const DRAW_MS = 1500;
/** Height of one repeat of the travelling highlight, in viewBox units.
 *  One band per ~2.6s cycle. */
const SWEEP_BAND = 130;

/* Palette. Last month is a calm grey-brown so it reads as history;
   this month is green when ahead of that line and amber when behind,
   which is the whole message of the slide.

   The two *Ramp triples drive the line's vertical gradient: low at the
   chart floor, high at its ceiling. Kept as three stops rather than two
   so the mid-tone — the colour the legend and the headline figures use
   — actually appears on the line instead of only at its ends. */
function palette(dark: boolean) {
  return {
    ink: dark ? "#fff" : "#1a1a1a",
    muted: dark ? "rgba(255,255,255,0.52)" : "#8a7a55",
    axis: dark ? "rgba(255,255,255,0.45)" : "#a2957a",
    rule: dark ? "rgba(255,255,255,0.10)" : "#e7e1d6",
    grid: dark ? "rgba(255,255,255,0.08)" : "rgba(45,36,16,0.07)",
    prev: dark ? "#a8a29e" : "#9a8f7d",
    ahead: dark ? "#4ade80" : "#15803d",
    behind: dark ? "#fbbf24" : "#b45309",
    aheadRamp: dark
      ? { low: "#166534", mid: "#22c55e", high: "#86efac" }
      : { low: "#14532d", mid: "#15803d", high: "#4ade80" },
    behindRamp: dark
      ? { low: "#7c2d12", mid: "#d97706", high: "#fcd34d" }
      : { low: "#7c2d12", mid: "#b45309", high: "#f59e0b" },
    panel: dark ? "rgba(255,255,255,0.04)" : "#fff",
    /* Opaque twin of `panel` — an SVG marker cannot punch through a
       translucent fill, so the ring around the line's head needs a
       solid colour to sit on. */
    panelSolid: dark ? "#141210" : "#fff",
    panelBorder: dark ? "rgba(255,255,255,0.11)" : "#e7e1d6",
    /* Stock slide. Sandstone takes the warm stone tone the app already
       uses for it; marble a cool one, so the two columns are told apart
       at a glance from across the floor. */
    sand: dark ? "#d8a75b" : "#b45309",
    marble: dark ? "#67c9e8" : "#0369a1",
  };
}

/** Cumulative line through the points, in SVG user units. */
function linePath(pts: ProductionPoint[], xOf: (d: number) => number, yOf: (v: number) => number): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.day).toFixed(1)} ${yOf(p.cum).toFixed(1)}`).join(" ");
}

/** One month-vs-last-month chart. Carving and cutting both render
 *  through this — Daksh asked for cutting as "the same graph thing", and
 *  two copies of a chart is two places for the comparison to drift. */
export function ProductionTvSlide({
  data, series, title, subtitle, dark,
}: {
  data: FloorProduction;
  series: MonthSeries;
  title: string;
  /** What the metric counts. Carving signs work off; cutting turns
   *  blocks into slabs. Saying "approved work" on both was wrong. */
  subtitle: string;
  dark: boolean;
}) {
  const C = palette(dark);
  const t = series.totals;
  const ahead = t.vsLastPct == null ? true : t.vsLastPct >= 0;
  const ramp = ahead ? C.aheadRamp : C.behindRamp;
  const nowColor = ramp.mid;

  /* Chart geometry.
     preserveAspectRatio is "meet", NOT "none". With "none" the viewBox
     stretched to the panel's width and every stroke and axis number
     came out horizontally squashed — that distortion was most of why
     the slide looked crude. The viewBox aspect below is matched to the
     panel it sits in — measured 2.53:1 on a 1920x1080 wall — so "meet"
     letterboxes by only a few pixels on the screen this actually runs
     on. Change the header or tile heights above and this wants
     re-measuring, or the chart starts floating in its panel. */
  const W = 1000, H = 395;
  const padL = 92, padR = 118, padT = 26, padB = 48;
  const maxDay = Math.max(data.daysInMonth, data.daysInPrevMonth);
  const peak = Math.max(
    1,
    t.prevMonthFull,
    series.thisMonth.length ? series.thisMonth[series.thisMonth.length - 1].cum : 0,
  );
  const xOf = (d: number) => padL + ((d - 1) / Math.max(1, maxDay - 1)) * (W - padL - padR);
  const yOf = (v: number) => H - padB - (v / peak) * (H - padT - padB);
  const baseY = H - padB;

  const prevPath = linePath(series.prevMonth, xOf, yOf);
  const thisPath = linePath(series.thisMonth, xOf, yOf);
  // Same line closed down to the baseline — the soft wash under it is
  // what stops a bare stroke reading as a toy.
  const thisArea = thisPath
    ? `${thisPath} L ${xOf(series.thisMonth[series.thisMonth.length - 1].day).toFixed(1)} ${baseY} L ${xOf(1).toFixed(1)} ${baseY} Z`
    : "";
  const last = series.thisMonth.length ? series.thisMonth[series.thisMonth.length - 1] : null;
  // Top of the running line — the ramp's bright end. Cumulative, so the
  // last point is always the highest.
  const headY = last ? yOf(last.cum) : padT;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * peak);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.8px", color: C.ink }}>
            {title}
          </span>
          <span style={{ fontSize: 18, color: C.muted, fontWeight: 500, letterSpacing: "0.01em" }}>
            {data.monthLabel} · day {data.today} of {data.daysInMonth} · {subtitle}
          </span>
        </div>
        <div style={{ height: 1, background: C.rule, marginTop: 12 }} />
      </div>

      <div style={{ display: "flex", gap: 12, flex: "0 0 auto" }}>
        <NumTile label={`${data.monthLabel} so far`} value={fmt0(t.thisMonth)} unit="CFT" fg={nowColor} dark={dark} big />
        <NumTile
          label={`${data.prevMonthLabel} by day ${data.today}`}
          value={fmt0(t.prevMonthToDate)}
          unit="CFT"
          fg={C.prev}
          dark={dark}
        />
        <NumTile
          label={ahead ? "Ahead of last month" : "Behind last month"}
          value={t.vsLastPct == null ? "—" : `${t.vsLastPct >= 0 ? "+" : ""}${t.vsLastPct.toFixed(0)}%`}
          unit=""
          fg={nowColor}
          dark={dark}
        />
        <NumTile
          label={`On pace for · ${data.prevMonthLabel.split(" ")[0]} finished ${fmt0(t.prevMonthFull)}`}
          value={fmt0(t.projected)}
          unit="CFT"
          fg={C.ink}
          dark={dark}
        />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: C.panel,
          border: `1px solid ${C.panelBorder}`,
          borderRadius: 14,
          boxShadow: dark ? "none" : "0 1px 3px rgba(45,36,16,0.05)",
          padding: "10px 14px 4px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <style>{`
          @keyframes mtcpl-head-in {
            from { opacity: 0; transform: scale(0.7); }
            to   { opacity: 1; transform: scale(1); }
          }
          .mtcpl-head {
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center;
            animation: mtcpl-head-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${DRAW_MS - 120}ms forwards;
          }
          /* A wall TV never asks for this, but a laptop opening the same
             URL might: skip straight to the finished chart. */
          @media (prefers-reduced-motion: reduce) {
            .mtcpl-head { opacity: 1; animation: none; }
          }
        `}</style>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", flex: 1, minHeight: 0 }}>
          <defs>
            {/* A vertical ramp in user space: dark at the baseline,
                bright at the head of the line. Because it is anchored to
                fixed Y coordinates rather than to the path, the colour
                at a given height is the same wherever the line happens
                to be — it does not chase the wiggle. That is the
                "constant" part.

                It spans the LINE's own height, not the chart's. Anchored
                to the chart the bright stop sat at a level the line
                never reaches (it is at 4,992 of a 8,312 scale), so two
                thirds of the ramp was wasted above it and the stroke
                read as flat dark green. */}
            <linearGradient id="mtcpl-line-ramp" gradientUnits="userSpaceOnUse" x1={0} y1={baseY} x2={0} y2={headY}>
              <stop offset="0%" stopColor={ramp.low} />
              <stop offset="55%" stopColor={ramp.mid} />
              <stop offset="100%" stopColor={ramp.high} />
            </linearGradient>
            <linearGradient id="mtcpl-area-ramp" gradientUnits="userSpaceOnUse" x1={0} y1={headY} x2={0} y2={baseY}>
              <stop offset="0%" stopColor={ramp.mid} stopOpacity={dark ? 0.34 : 0.26} />
              <stop offset="100%" stopColor={ramp.mid} stopOpacity={0} />
            </linearGradient>

            {/* THE LIVE SWEEP. A band of light that runs up the line for
                ever, the way a loading bar does. It is a second gradient
                painted over the static ramp rather than a replacement
                for it, so the line keeps its dark-at-the-bottom shape
                and the sweep only adds the movement.

                spreadMethod="repeat" tiles the band up the whole line,
                and translating by exactly one band height per cycle
                makes the loop seamless — the tile that leaves the top is
                the tile arriving at the bottom, so there is no jump at
                the wrap. Purely decorative: it carries no data, which is
                why it is soft-edged and translucent rather than a hard
                stripe someone might try to read a value off. */}
            <linearGradient
              id="mtcpl-line-sweep"
              gradientUnits="userSpaceOnUse"
              spreadMethod="repeat"
              x1={0}
              y1={baseY}
              x2={0}
              y2={baseY - SWEEP_BAND}
            >
              <stop offset="0%" stopColor={ramp.high} stopOpacity={0} />
              <stop offset="45%" stopColor={ramp.high} stopOpacity={dark ? 0.85 : 0.6} />
              <stop offset="90%" stopColor={ramp.high} stopOpacity={0} />
              <animateTransform
                attributeName="gradientTransform"
                type="translate"
                values={`0 0; 0 ${-SWEEP_BAND}`}
                dur="2.6s"
                repeatCount="indefinite"
              />
            </linearGradient>

            {/* THE DRAW-IN. A rectangle that widens from nothing to the
                full chart, clipping the wash and both strokes of this
                month, so the line appears to be drawn day by day as the
                slide arrives. `fill="freeze"` holds it open afterwards.
                The slide is re-keyed on every rotation step (see
                floor-client), so this replays each time the wall comes
                back round to it rather than only on first load. */}
            <clipPath id="mtcpl-wipe">
              <rect x={0} y={0} width={0} height={H}>
                <animate
                  attributeName="width"
                  values={`0; ${W}`}
                  keyTimes="0; 1"
                  calcMode="spline"
                  // Gentle ease-out, not a snap. 0.25 0.9 0.3 1 was
                  // tried first and measured at ~90% width within
                  // 200ms of starting — the eye reads that as the chart
                  // appearing, not drawing. This spends real time in the
                  // middle so the month visibly plays out.
                  keySplines="0.4 0 0.25 1"
                  dur={`${DRAW_MS}ms`}
                  fill="freeze"
                />
              </rect>
            </clipPath>
          </defs>

          {ticks.map((v, i) => (
            <g key={i}>
              <line
                x1={padL}
                y1={yOf(v)}
                x2={W - padR}
                y2={yOf(v)}
                stroke={C.grid}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={padL - 14} y={yOf(v) + 5} textAnchor="end" fontSize={15} fontWeight={500} fill={C.axis}>
                {fmt0(v)}
              </text>
            </g>
          ))}

          {/* Day-of-month scale: the 1st, every 5th, and the last day —
              but drop the last when it would sit on top of a 5-tick
              (31 crowding into 30, which is what a 31-day month does). */}
          {Array.from({ length: maxDay }, (_, i) => i + 1)
            .filter((d) => d === 1 || d % 5 === 0 || (d === maxDay && maxDay % 5 > 1))
            .map((d) => (
              <text key={d} x={xOf(d)} y={H - padB + 25} textAnchor="middle" fontSize={15} fontWeight={500} fill={C.axis}>
                {d}
              </text>
            ))}

          {/* Today's mark, kept faint — it locates the comparison, it is
              not one of the two things being compared. */}
          <line x1={xOf(data.today)} y1={padT} x2={xOf(data.today)} y2={baseY} stroke={C.axis} strokeWidth={1} strokeDasharray="2 7" opacity={0.45} />

          {/* Last month: thin, dashed, receding. */}
          <path d={prevPath} fill="none" stroke={C.prev} strokeWidth={2.5} strokeDasharray="9 7" strokeLinecap="round" opacity={0.85} />
          <text
            x={W - padR + 12}
            y={yOf(series.prevMonth.length ? series.prevMonth[series.prevMonth.length - 1].cum : 0) + 5}
            fontSize={16}
            fontWeight={600}
            fill={C.prev}
          >
            {data.prevMonthLabel.split(" ")[0]}
          </text>

          {/* This month: the wash, the ramped stroke, then the sweep
              riding on top — all three revealed by the same wipe. */}
          <g clipPath="url(#mtcpl-wipe)">
            <path d={thisArea} fill="url(#mtcpl-area-ramp)" stroke="none" />
            <path
              d={thisPath}
              fill="none"
              stroke="url(#mtcpl-line-ramp)"
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={thisPath}
              fill="none"
              stroke="url(#mtcpl-line-sweep)"
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          {last && (
            <>
              {/* A ring rather than a blob, and the figure sits ABOVE the
                  head of the line so it can never collide with last
                  month's dashes running underneath it. Held back until
                  the line has finished drawing, so it lands on the head
                  instead of hanging in mid-air waiting for it. */}
              <g className="mtcpl-head">
                <circle cx={xOf(last.day)} cy={yOf(last.cum)} r={9} fill={C.panelSolid} stroke={ramp.high} strokeWidth={3} />
                <text
                  x={xOf(last.day)}
                  y={yOf(last.cum) - 20}
                  textAnchor="middle"
                  fontSize={21}
                  fontWeight={700}
                  fill={ramp.mid}
                  letterSpacing="-0.3"
                >
                  {fmt0(last.cum)}
                </text>
              </g>
            </>
          )}
        </svg>
        <div style={{ display: "flex", gap: 24, justifyContent: "center", paddingBottom: 6, flex: "0 0 auto" }}>
          <Legend color={nowColor} label={`${data.monthLabel} (running)`} dark={dark} />
          <Legend color={C.prev} label={`${data.prevMonthLabel} (finished)`} dashed dark={dark} />
        </div>
      </div>
    </div>
  );
}

/** Raw block stock, split the way the yard is actually counted:
 *  sandstone measured in CFT, marble weighed in tonnes, each broken
 *  down by the individual stone underneath. Plus what was bought this
 *  month, so the standing pile is read against its top-up rather than
 *  in isolation.
 *
 *  The two categories deliberately do NOT share a number. Adding a
 *  tonne of marble to a cubic foot of sandstone is the fudge the daily
 *  report had to make and then footnote; here there is room to just
 *  show both properly. The "~ CFT" under marble is the company's own
 *  8 CFT/tonne and is marked with a tilde because it is a conversion,
 *  not a measurement. */
export function StockTvSlide({ data, dark }: { data: FloorProduction; dark: boolean }) {
  const C = palette(dark);
  const st = data.stock;
  if (!st) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: C.muted }}>Stock unavailable</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.8px", color: C.ink }}>
            Block stock
          </span>
          <span style={{ fontSize: 18, color: C.muted, fontWeight: 500 }}>
            uncut blocks in the yard · {fmt0(st.sandstone.blocks + st.marble.blocks)} blocks
          </span>
        </div>
        <div style={{ height: 1, background: C.rule, marginTop: 12 }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14 }}>
        <StockColumn
          title="SANDSTONE"
          headline={fmt0(st.sandstone.cft)}
          unit="CFT"
          sub={`${fmt0(st.sandstone.blocks)} blocks`}
          accent={C.sand}
          rows={st.sandstone.byStone}
          valueOf={(g) => `${fmt0(g.cft)} CFT`}
          shareOf={(g) => (st.sandstone.cft > 0 ? g.cft / st.sandstone.cft : 0)}
          bought={
            st.purchased.sandstone.blocks > 0
              ? `+ ${fmt0(st.purchased.sandstone.cft)} CFT · ${st.purchased.sandstone.blocks} blocks`
              : "nothing bought yet"
          }
          boughtLabel={`BOUGHT IN ${data.monthLabel.split(" ")[0].toUpperCase()}`}
          dark={dark}
        />
        <StockColumn
          title="MARBLE"
          headline={fmt1(st.marble.tonnes)}
          unit="T"
          sub={`${fmt0(st.marble.blocks)} blocks · ~${fmt0(st.marble.cftEquiv)} CFT`}
          accent={C.marble}
          rows={st.marble.byStone}
          valueOf={(g) => `${fmt1(g.tonnes)} T`}
          shareOf={(g) => (st.marble.tonnes > 0 ? g.tonnes / st.marble.tonnes : 0)}
          bought={
            st.purchased.marble.blocks > 0
              ? `+ ${fmt1(st.purchased.marble.tonnes)} T · ${st.purchased.marble.blocks} blocks`
              : "nothing bought yet"
          }
          boughtLabel={`BOUGHT IN ${data.monthLabel.split(" ")[0].toUpperCase()}`}
          dark={dark}
        />
      </div>
    </div>
  );
}

function StockColumn({
  title, headline, unit, sub, accent, rows, valueOf, shareOf, bought, boughtLabel, dark,
}: {
  title: string;
  headline: string;
  unit: string;
  sub: string;
  accent: string;
  rows: StockStone[];
  valueOf: (g: StockStone) => string;
  shareOf: (g: StockStone) => number;
  bought: string;
  boughtLabel: string;
  dark: boolean;
}) {
  const C = palette(dark);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: C.panel,
        border: `1px solid ${C.panelBorder}`,
        borderRadius: 14,
        boxShadow: dark ? "none" : "0 1px 3px rgba(45,36,16,0.05)",
        padding: "16px 20px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        // A coloured edge rather than a coloured panel: the stone names
        // below need to stay the loudest thing in the column.
        borderLeft: `5px solid ${accent}`,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, letterSpacing: "0.12em" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 58,
            fontWeight: 700,
            color: C.ink,
            fontFamily: "ui-monospace, monospace",
            lineHeight: 1,
            letterSpacing: "-1.5px",
          }}
        >
          {headline}
        </span>
        <span style={{ fontSize: 22, fontWeight: 600, color: C.muted }}>{unit}</span>
      </div>
      <div style={{ fontSize: 17, color: C.muted, fontWeight: 600, marginTop: -4 }}>{sub}</div>

      <div style={{ height: 1, background: C.rule }} />

      {/* Per-stone rows. The bar is each stone's share of its OWN
          category, so the split reads without needing the numbers. */}
      {/* Spread down the panel, not stacked at the top. There are only a
          handful of stones in stock, so top-aligning left a dead half-
          panel; centring fixed that but then a 2-stone column and a
          3-stone one sat at different heights and read as a mistake.
          Even distribution fills both and looks deliberate either way. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "space-evenly", gap: 14 }}>
        {rows.map((g) => (
          <div key={g.stone} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: C.ink, letterSpacing: "-0.2px" }}>
                {prettyStone(g.stone)}
              </span>
              <span
                style={{
                  fontSize: 21,
                  fontWeight: 700,
                  color: C.ink,
                  fontFamily: "ui-monospace, monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {valueOf(g)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  borderRadius: 5,
                  background: dark ? "rgba(255,255,255,0.07)" : "#f2efe8",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(1, Math.min(100, shareOf(g) * 100))}%`,
                    height: "100%",
                    background: accent,
                    borderRadius: 5,
                  }}
                />
              </div>
              <span style={{ fontSize: 15, color: C.muted, fontWeight: 600, whiteSpace: "nowrap", width: 78, textAlign: "right" }}>
                {g.blocks} blocks
              </span>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <span style={{ fontSize: 19, color: C.muted, fontWeight: 600 }}>No blocks in stock.</span>
        )}
      </div>

      <div style={{ height: 1, background: C.rule }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.muted, letterSpacing: "0.09em" }}>{boughtLabel}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: accent, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
          {bought}
        </span>
      </div>
    </div>
  );
}

/** "PinkStone" → "PINK STONE", "Rajnagarmarble" → "RAJNAGAR MARBLE".
 *  Stone names are entered inconsistently — some camelCase, some run
 *  together in lower case — and in caps they become one long word. The
 *  second rule only splits a trailing "marble"/"stone", which is the
 *  shape every one of them actually has. */
function prettyStone(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])(marble|stone)$/i, "$1 $2")
    .toUpperCase();
}

function NumTile({
  label, value, unit, fg, dark, big = false,
}: {
  label: string; value: string; unit: string; fg: string; dark: boolean; big?: boolean;
}) {
  const C = palette(dark);
  return (
    <div
      style={{
        flex: 1,
        background: C.panel,
        border: `1px solid ${C.panelBorder}`,
        borderRadius: 12,
        boxShadow: dark ? "none" : "0 1px 3px rgba(45,36,16,0.05)",
        padding: "11px 16px 13px",
      }}
    >
      {/* Small, widely tracked caption over a large figure — the label
          should be found when looked for, not compete with the number. */}
      <div style={{ fontSize: 14, fontWeight: 600, color: C.muted, letterSpacing: "0.09em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6 }}>
        <span
          style={{
            fontSize: big ? 56 : 42,
            fontWeight: 700,
            color: fg,
            fontFamily: "ui-monospace, monospace",
            lineHeight: 1,
            letterSpacing: "-1px",
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 18, fontWeight: 600, color: C.muted, letterSpacing: "0.04em" }}>{unit}</span>}
      </div>
    </div>
  );
}

function Legend({ color, label, dashed = false, dark }: { color: string; label: string; dashed?: boolean; dark: boolean }) {
  const C = palette(dark);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 16, fontWeight: 600, color: C.muted, letterSpacing: "0.02em" }}>
      <span
        style={{
          width: 34,
          height: 0,
          borderTop: `${dashed ? 2 : 3}px ${dashed ? "dashed" : "solid"} ${color}`,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
