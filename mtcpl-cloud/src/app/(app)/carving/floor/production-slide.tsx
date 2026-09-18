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
   which is the whole message of the slide. */
function palette(dark: boolean) {
  return {
    ink: dark ? "#fff" : "#1a1a1a",
    muted: dark ? "rgba(255,255,255,0.55)" : "#8a7a55",
    grid: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)",
    prev: dark ? "#a8a29e" : "#78716c",
    ahead: dark ? "#4ade80" : "#15803d",
    behind: dark ? "#fbbf24" : "#b45309",
    panel: dark ? "rgba(255,255,255,0.05)" : "#fff",
    panelBorder: dark ? "rgba(255,255,255,0.14)" : "#e4ddd2",
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
  const nowColor = ahead ? C.ahead : C.behind;

  // Chart geometry. viewBox units, scaled by the parent to fill the wall.
  const W = 1000, H = 380;
  const padL = 96, padR = 130, padT = 24, padB = 46;
  const maxDay = Math.max(data.daysInMonth, data.daysInPrevMonth);
  const peak = Math.max(
    1,
    t.prevMonthFull,
    data.thisMonth.length ? data.thisMonth[data.thisMonth.length - 1].cum : 0,
  );
  const xOf = (d: number) => padL + ((d - 1) / Math.max(1, maxDay - 1)) * (W - padL - padR);
  const yOf = (v: number) => H - padB - (v / peak) * (H - padT - padB);

  const prevPath = linePath(data.prevMonth, xOf, yOf);
  const thisPath = linePath(data.thisMonth, xOf, yOf);
  const last = data.thisMonth.length ? data.thisMonth[data.thisMonth.length - 1] : null;

  // Four horizontal guides — enough to judge a level, few enough not to
  // clutter a screen nobody can zoom into.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * peak);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", flex: "0 0 auto" }}>
        <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.6px", color: C.ink }}>
          CARVED THIS MONTH
        </span>
        <span style={{ fontSize: 20, color: C.muted, fontWeight: 600 }}>
          {data.monthLabel} · day {data.today} of {data.daysInMonth} · approved work
        </span>
      </div>

      {/* Headline row — the four numbers the floor actually argues about. */}
      <div style={{ display: "flex", gap: 14, flex: "0 0 auto" }}>
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
          fg={C.muted}
          dark={dark}
        />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: C.panel,
          border: `2px solid ${C.panelBorder}`,
          borderRadius: 16,
          padding: "14px 18px 6px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", flex: 1, minHeight: 0 }}>
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke={C.grid} strokeWidth={1} />
              <text x={padL - 12} y={yOf(v) + 6} textAnchor="end" fontSize={17} fontWeight={700} fill={C.muted}>
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
              <text key={d} x={xOf(d)} y={H - padB + 26} textAnchor="middle" fontSize={17} fontWeight={700} fill={C.muted}>
                {d}
              </text>
            ))}

          {/* Last month — dashed, calm, the line to beat. */}
          <path d={prevPath} fill="none" stroke={C.prev} strokeWidth={4} strokeDasharray="10 8" strokeLinecap="round" />
          <text
            x={W - padR + 10}
            y={yOf(data.prevMonth.length ? data.prevMonth[data.prevMonth.length - 1].cum : 0) + 6}
            fontSize={18}
            fontWeight={800}
            fill={C.prev}
          >
            {data.prevMonthLabel.split(" ")[0]}
          </text>

          {/* Today's vertical marker — where the two months are compared. */}
          <line
            x1={xOf(data.today)}
            y1={padT}
            x2={xOf(data.today)}
            y2={H - padB}
            stroke={nowColor}
            strokeWidth={2}
            strokeDasharray="4 6"
            opacity={0.5}
          />

          {/* This month — solid, thick, coloured by whether it is winning. */}
          <path d={thisPath} fill="none" stroke={nowColor} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          {last && (
            <>
              <circle cx={xOf(last.day)} cy={yOf(last.cum)} r={10} fill={nowColor} />
              <text x={xOf(last.day) + 18} y={yOf(last.cum) + 7} fontSize={22} fontWeight={800} fill={nowColor}>
                {fmt0(last.cum)}
              </text>
            </>
          )}
        </svg>
        <div style={{ display: "flex", gap: 26, justifyContent: "center", paddingBottom: 8, flex: "0 0 auto" }}>
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
        border: `2px solid ${C.panelBorder}`,
        borderRadius: 14,
        padding: "12px 18px",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: big ? 62 : 46, fontWeight: 900, color: fg, fontFamily: "ui-monospace, monospace", lineHeight: 1.05 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 22, fontWeight: 800, color: C.muted }}>{unit}</span>}
      </div>
    </div>
  );
}

function Legend({ color, label, dashed = false, dark }: { color: string; label: string; dashed?: boolean; dark: boolean }) {
  const C = palette(dark);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 19, fontWeight: 700, color: C.muted }}>
      <span
        style={{
          width: 44,
          height: 0,
          borderTop: `${dashed ? 4 : 6}px ${dashed ? "dashed" : "solid"} ${color}`,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
