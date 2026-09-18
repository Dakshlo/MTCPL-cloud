"use client";

/**
 * The two number slides on the carving wall (Daksh, Sep 2026).
 *
 *   ProductionTvSlide — this month's carved output climbing toward last
 *     month's finished curve. Two lines on one chart, cumulative by day
 *     of month, so "ahead or behind" is read off which line is higher
 *     at today's mark rather than by comparing two months of different
 *     lengths.
 *
 *   VendorsTvSlide — all CNC vendors on one page: what each has carved
 *     this month against their own same-day figure last month, with a
 *     bar so the split of the month's work is obvious at a glance.
 *
 * Both are drawn as inline SVG with no chart library: the wall runs an
 * always-on browser and every kilobyte of JS is a kilobyte that can
 * fail to load at 6 am with nobody there to reload it.
 *
 * Sized for a TV seen from across a workshop — the smallest type here
 * is 18px before TvFit scales the slide up to fill the screen.
 */

import type { FloorProduction, FloorVendorNumbers, ProductionPoint } from "@/lib/floor-production-data";

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");

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
  };
}

/** Cumulative line through the points, in SVG user units. */
function linePath(pts: ProductionPoint[], xOf: (d: number) => number, yOf: (v: number) => number): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.day).toFixed(1)} ${yOf(p.cum).toFixed(1)}`).join(" ");
}

export function ProductionTvSlide({ data, dark }: { data: FloorProduction; dark: boolean }) {
  const C = palette(dark);
  const t = data.totals;
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
    data.thisMonth.length ? data.thisMonth[data.thisMonth.length - 1].cum : 0,
  );
  const xOf = (d: number) => padL + ((d - 1) / Math.max(1, maxDay - 1)) * (W - padL - padR);
  const yOf = (v: number) => H - padB - (v / peak) * (H - padT - padB);
  const baseY = H - padB;

  const prevPath = linePath(data.prevMonth, xOf, yOf);
  const thisPath = linePath(data.thisMonth, xOf, yOf);
  // Same line closed down to the baseline — the soft wash under it is
  // what stops a bare stroke reading as a toy.
  const thisArea = thisPath
    ? `${thisPath} L ${xOf(data.thisMonth[data.thisMonth.length - 1].day).toFixed(1)} ${baseY} L ${xOf(1).toFixed(1)} ${baseY} Z`
    : "";
  const last = data.thisMonth.length ? data.thisMonth[data.thisMonth.length - 1] : null;
  // Top of the running line — the ramp's bright end. Cumulative, so the
  // last point is always the highest.
  const headY = last ? yOf(last.cum) : padT;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * peak);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.8px", color: C.ink }}>
            Carved this month
          </span>
          <span style={{ fontSize: 18, color: C.muted, fontWeight: 500, letterSpacing: "0.01em" }}>
            {data.monthLabel} · day {data.today} of {data.daysInMonth} · approved work
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
            y={yOf(data.prevMonth.length ? data.prevMonth[data.prevMonth.length - 1].cum : 0) + 5}
            fontSize={16}
            fontWeight={600}
            fill={C.prev}
          >
            {data.prevMonthLabel.split(" ")[0]}
          </text>

          {/* This month: the wash, then the ramped stroke over it. */}
          <path d={thisArea} fill="url(#mtcpl-area-ramp)" stroke="none" />
          <path
            d={thisPath}
            fill="none"
            stroke="url(#mtcpl-line-ramp)"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {last && (
            <>
              {/* A ring rather than a blob, and the figure sits ABOVE the
                  head of the line so it can never collide with last
                  month's dashes running underneath it. */}
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

export function VendorsTvSlide({ data, dark }: { data: FloorProduction; dark: boolean }) {
  const C = palette(dark);
  // Bars are scaled against the busiest vendor so the split of the
  // month's work is obvious even when the totals are small.
  const peak = Math.max(1, ...data.vendors.map((v) => Math.max(v.thisMonth, v.lastMonthToDate)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", flex: "0 0 auto" }}>
        <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.6px", color: C.ink }}>
          VENDOR SCOREBOARD
        </span>
        <span style={{ fontSize: 20, color: C.muted, fontWeight: 600 }}>
          {data.monthLabel} to day {data.today} · vs the same days of {data.prevMonthLabel}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {data.vendors.map((v) => (
          <VendorRow key={v.vendorId} v={v} peak={peak} C={C} dark={dark} />
        ))}
        {data.vendors.length === 0 && (
          <div style={{ color: C.muted, fontSize: 24, fontWeight: 700 }}>No active CNC vendors.</div>
        )}
      </div>
    </div>
  );
}

function VendorRow({
  v, peak, C, dark,
}: {
  v: FloorVendorNumbers;
  peak: number;
  C: ReturnType<typeof palette>;
  dark: boolean;
}) {
  const pct = v.lastMonthToDate > 0 ? ((v.thisMonth - v.lastMonthToDate) / v.lastMonthToDate) * 100 : null;
  const ahead = pct == null ? true : pct >= 0;
  const fg = ahead ? C.ahead : C.behind;
  const w = (x: number) => `${Math.max(0, Math.min(100, (x / peak) * 100))}%`;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        background: C.panel,
        border: `2px solid ${C.panelBorder}`,
        borderRadius: 16,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 24,
      }}
    >
      <div style={{ width: 260, flex: "0 0 auto" }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: C.ink, letterSpacing: "-0.4px" }}>{v.name}</div>
        <div style={{ fontSize: 19, color: C.muted, fontWeight: 600 }}>
          {v.machines} CNC · {v.carving} running · {v.idle} free
        </div>
      </div>

      {/* Two stacked bars: this month solid over last month's ghost, so
          the comparison is a length not a subtraction. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 30, background: dark ? "rgba(255,255,255,0.07)" : "#f2efe8", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: w(v.thisMonth), height: "100%", background: fg, borderRadius: 6 }} />
          </div>
          <div style={{ width: 190, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 30, fontWeight: 800, color: fg }}>
            {fmt0(v.thisMonth)} <span style={{ fontSize: 18 }}>CFT</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 16, background: dark ? "rgba(255,255,255,0.05)" : "#f7f5f0", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: w(v.lastMonthToDate), height: "100%", background: C.prev, opacity: 0.55, borderRadius: 5 }} />
          </div>
          <div style={{ width: 190, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 20, fontWeight: 700, color: C.muted }}>
            {fmt0(v.lastMonthToDate)} last
          </div>
        </div>
      </div>

      <div style={{ width: 150, flex: "0 0 auto", textAlign: "right" }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: fg, fontFamily: "ui-monospace, monospace", lineHeight: 1.1 }}>
          {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
        </div>
        <div style={{ fontSize: 17, color: C.muted, fontWeight: 700 }}>{v.slabs} slabs</div>
      </div>
    </div>
  );
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
