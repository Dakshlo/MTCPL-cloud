"use client";

// ──────────────────────────────────────────────────────────────────
// CNC Logbook (route: /carving/plan, mig 215) — client board:
//   • Four route cards (CNC / Outsource / No carving / Undecided):
//     stage ring + per-stage slabs & CFT + both totals.
//   • ONE deep CNC-capacity card — pending load, 30-day output chart,
//     and the days-of-work-left verdict.
//   • Temple section: our own dropdown → LEFT progress rings + work
//     remaining, RIGHT the same temple split by route.
//   • Slab list + every route change lives in the full-screen SEAT MAP
//     (opened from Total slabs): hover for details, click to re-route,
//     or turn on multi-select and set one route for many at once.
//   (No PeekIframe on this page, so hover transforms are safe.)
// ──────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { METHOD_BADGE, type CarvingMethod } from "@/lib/carving-method";
import { setCarvingMethodBulkAction } from "./actions";

export type MethodKey = CarvingMethod | "nil";
export type Tot = { slabs: number; cft: number };
export type StageTotals = { notCut: Tot; cutWaiting: Tot; inCarving: Tot; done: Tot };
export type MethodSummary = { total: Tot; stages: StageTotals };
export type TempleMethodRow = { temple: string; methods: Record<MethodKey, MethodSummary> };
export type PlanSlab = {
  id: string; temple: string; status: string; label: string | null;
  stone: string | null; description: string | null;
  section: string | null; element: string | null;
  l: number; w: number; t: number; priority: boolean;
  method: MethodKey; stage: keyof StageTotals;
};
// daily = carved CFT per day, index 0 = 30 days ago … 29 = today.
export type CncForecast = { machineCount: number; cncPending: Tot; cncDone30: Tot; daily: number[] };

const METHOD_ORDER: MethodKey[] = ["cnc", "outsource", "none", "nil"];
// CNC Logbook wording (Daksh): Outsource reads "Manual carving" and
// No carving reads "Direct" — the stored values are unchanged.
const METHOD_THEME: Record<MethodKey, { label: string; fg: string }> = {
  cnc: { label: "CNC", fg: METHOD_BADGE.cnc.fg },
  outsource: { label: "Manual carving", fg: METHOD_BADGE.outsource.fg },
  none: { label: "Direct", fg: METHOD_BADGE.none.fg },
  nil: { label: "Undecided", fg: "#6b7280" },
};
const STAGE_LABELS: Array<{ key: keyof StageTotals; label: string }> = [
  { key: "notCut", label: "Not cut yet" },
  { key: "cutWaiting", label: "Cutted waiting" },
  { key: "inCarving", label: "In carving" },
  { key: "done", label: "Carving done" },
];
const STAGE_COLOR: Record<keyof StageTotals, string> = {
  notCut: "#6b7280",
  cutWaiting: "#0369a1",
  inCarving: "#b45309",
  done: "#15803d",
};

/** Number + unit as one visually distinct stat. `tone` separates a COUNT
 *  (ink) from a VOLUME (muted/boxed) so "107 slabs" and "313 CFT" can
 *  never be misread as the same kind of number. */
function Stat({ label, value, unit, tone = "count", size = 26 }: {
  label: string; value: string; unit: string; tone?: "count" | "volume"; size?: number;
}) {
  const isCount = tone === "count";
  return (
    <div
      style={{
        padding: "7px 13px",
        borderRadius: 8,
        background: isCount ? "transparent" : "var(--surface-alt, rgba(0,0,0,0.035))",
        border: isCount ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 1 }}>
        <span style={{ fontSize: size, fontWeight: 800, lineHeight: 1.05, color: isCount ? "var(--text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cftOf = (s: PlanSlab) => (s.l * s.w * s.t) / 1728;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** SVG progress ring. */
function Ring({ value, size = 86, stroke = 9, color, label, sub }: {
  value: number; size?: number; stroke?: number; color: string; label: string; sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, value / 100)));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset .7s ease" }}
        />
        <text
          x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
          style={{ transform: "rotate(90deg)", transformOrigin: "center", fontSize: size * 0.24, fontWeight: 800, fill: "var(--text)" }}
        >
          {Math.round(value)}%
        </text>
      </svg>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginTop: -3 }}>{sub}</div>}
    </div>
  );
}

/** One ring split into all four stages, total slab count in the middle.
 *  Drawn done → in-carving → cut-waiting → not-cut clockwise from the top,
 *  so the finished share always starts at 12 o'clock. */
const DONUT_ORDER: Array<keyof StageTotals> = ["done", "inCarving", "cutWaiting", "notCut"];

function StageDonut({ stages, total, centerValue, centerUnit, size = 96, stroke = 12 }: {
  stages: StageTotals; total: number; centerValue: string; centerUnit: string;
  size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const segs = DONUT_ORDER.map((key) => {
    const v = stages[key].slabs;
    const frac = total > 0 ? v / total : 0;
    const seg = { key, v, frac, start: acc };
    acc += frac;
    return seg;
  }).filter((s) => s.v > 0);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {segs.map((s) => (
          <circle
            key={s.key}
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={STAGE_COLOR[s.key]} strokeWidth={stroke}
            // 2px visual gap between neighbouring slices (skipped when a
            // single stage owns the whole ring, so it stays a full circle).
            strokeDasharray={`${Math.max(0, s.frac * c - (segs.length > 1 ? 2 : 0))} ${c}`}
            strokeDashoffset={-s.start * c}
            style={{ transition: "stroke-dasharray .7s ease, stroke-dashoffset .7s ease" }}
          >
            <title>{`${STAGE_LABELS.find((x) => x.key === s.key)?.label}: ${fmt0(s.v)} slabs · ${fmt0(stages[s.key].cft)} CFT`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ fontSize: centerValue.length > 4 ? 17 : 21, fontWeight: 800, lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {centerValue}
        </span>
        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginTop: 3 }}>
          {centerUnit}
        </span>
      </div>
    </div>
  );
}

/** Our own temple dropdown — button + panel with search, no native select. */
function TemplePicker({ temples, value, onPick }: {
  temples: TempleMethodRow[]; value: string; onPick: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  const totalOf = (t: TempleMethodRow) =>
    METHOD_ORDER.reduce((a, mk) => a + t.methods[mk].total.slabs, 0);
  const doneOf = (t: TempleMethodRow) =>
    METHOD_ORDER.reduce((a, mk) => a + t.methods[mk].stages.done.slabs, 0);
  const shown = temples.filter((t) => !q.trim() || t.temple.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    // Full width — the picker is the gateway to this whole section, and a
    // 520px box next to 18 long temple names was cramped (Daksh).
    <div ref={boxRef} style={{ position: "relative", flex: 1, minWidth: 260 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "13px 16px", fontSize: 14.5, fontWeight: 800, textAlign: "left",
          border: "2px solid var(--gold-border, #d8c49a)", borderRadius: 8,
          background: "var(--bg)", color: value ? "var(--text)" : "var(--muted)", cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? `🏛 ${value}` : "🏛 Choose temple"}
        </span>
        <span style={{ color: "var(--gold-dark)", fontSize: 12, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 80,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 16px 44px rgba(45,36,16,0.18)", overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type to filter temples…"
              style={{ width: "100%", padding: "8px 11px", fontSize: 12.5, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)" }}
            />
          </div>
          <div style={{ maxHeight: 330, overflowY: "auto" }}>
            {shown.map((t) => {
              const total = totalOf(t);
              const done = doneOf(t);
              const active = t.temple === value;
              return (
                <button
                  key={t.temple}
                  type="button"
                  onClick={() => { onPick(t.temple); setOpen(false); setQ(""); }}
                  className="plan-pick-row"
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
                    padding: "9px 13px", background: active ? "rgba(180,140,40,0.10)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border-light, var(--border))", cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, fontWeight: active ? 800 : 700, color: "var(--text)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.temple}</span>
                    <span style={{ flexShrink: 0, color: "var(--muted)", fontWeight: 700 }}>{fmt0(done)}/{fmt0(total)}</span>
                  </span>
                  <span style={{ display: "block", height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${pct(done, total)}%`, height: "100%", background: "var(--gold-dark)", borderRadius: 2 }} />
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: "var(--muted)" }}>No temple matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Slab seat map — every slab of the temple as one "cinema seat" ──
// Sections top→bottom follow the journey; carved slabs sit nearest the
// temple "screen" at the bottom. Seat colour = route, hover = full info.
// Hindi beside every English label — the floor reads these, not the office
// (Daksh).
const SEAT_SECTIONS: Array<{ key: keyof StageTotals; label: string; hi: string }> = [
  { key: "notCut", label: "Not cut yet", hi: "कटाई बाकी" },
  { key: "cutWaiting", label: "Cutted waiting", hi: "कट गया — वेटिंग" },
  { key: "inCarving", label: "In carving", hi: "कार्विंग चालू" },
  { key: "done", label: "Carving done", hi: "कार्विंग पूरी" },
];

/** "PALI-0010-2" → "0010-2" — the temple prefix is the map's title. */
const seatCode = (id: string) => id.replace(/^[^-]+-/, "");

/** A route can only be decided BEFORE carving starts. Once a slab is in
 *  carving or finished, the decision has already been executed — the seat
 *  stays visible for context but is locked. Mirrors the status list the
 *  server action enforces. */
const canRoute = (s: PlanSlab) => s.stage === "notCut" || s.stage === "cutWaiting";

/** Journey order for seats inside a mixed group: not cut → cutted waiting
 *  → in carving → done (Daksh). */
const STAGE_RANK: Record<keyof StageTotals, number> = { notCut: 0, cutWaiting: 1, inCarving: 2, done: 3 };

function SeatMap({ temple, rows, onClose }: {
  temple: string; rows: PlanSlab[]; onClose: () => void;
}) {
  const [tip, setTip] = useState<{ s: PlanSlab; x: number; y: number; below: boolean } | null>(null);
  // Clicked seat — same info card, pinned, with route-change buttons.
  const [pinned, setPinned] = useState<{ s: PlanSlab; x: number; y: number; below: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [routeFilter, setRouteFilter] = useState<MethodKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Multi-select: clicking seats collects them instead of opening a card,
  // then one route change applies to the whole selection.
  const [multi, setMulti] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Same seats, two groupings: by production stage (cinema rows) or by
  // component category, the way Temple View reads.
  const [groupBy, setGroupBy] = useState<"stage" | "category">("stage");
  // Route edits land here instantly (seat recolours, chips recount) while
  // router.refresh() reconciles in the background — search, filter and
  // scroll all survive because client state is untouched.
  const [overrides, setOverrides] = useState<Map<string, MethodKey>>(new Map());
  const qRef = useRef("");
  const pinnedRef = useRef(false);
  pinnedRef.current = pinned !== null;
  const selRef = useRef(0);
  selRef.current = sel.size;
  const router = useRouter();

  // Esc unwinds one step at a time: pinned card → selection → search →
  // close. The page behind must not scroll while the map is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pinnedRef.current) { setPinned(null); return; }
      if (selRef.current > 0) { setSel(new Set()); return; }
      if (qRef.current) { qRef.current = ""; setQ(""); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const effRows = useMemo(
    () => (overrides.size === 0 ? rows : rows.map((s) => { const o = overrides.get(s.id); return o ? { ...s, method: o } : s; })),
    [rows, overrides],
  );

  const applyRouteIds = async (ids: string[], m: CarvingMethod | null) => {
    if (busy || ids.length === 0) return;
    setBusy(m ?? "nil");
    const fd = new FormData();
    fd.set("ids", JSON.stringify(ids));
    fd.set("method", m ?? "");
    const res = await setCarvingMethodBulkAction(fd);
    setBusy(null);
    if (!res.ok) { alert(res.error); return; }
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, (m ?? "nil") as MethodKey);
      return next;
    });
    setPinned(null);
    setSel(new Set());
    router.refresh();
  };

  // Search across everything the tooltip shows + route name; the route
  // chips narrow further. Groups keep their status order underneath.
  const filtered = useMemo(() => {
    let r = effRows;
    if (routeFilter) r = r.filter((s) => s.method === routeFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      r = r.filter((s) => {
        const hay = [
          s.id, s.temple, s.label, s.stone, s.description, s.section, s.element,
          s.status.replace(/_/g, " "), METHOD_THEME[s.method].label,
          `${s.l}x${s.w}x${s.t}`, `${s.l}×${s.w}×${s.t}`,
        ].filter(Boolean).join(" · ").toLowerCase();
        return hay.includes(needle);
      });
    }
    return r;
  }, [effRows, q, routeFilter]);

  const byStage = useMemo(() => {
    const m = new Map<keyof StageTotals, PlanSlab[]>();
    for (const sec of SEAT_SECTIONS) m.set(sec.key, []);
    for (const s of filtered) m.get(s.stage)!.push(s);
    for (const arr of m.values()) arr.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return m;
  }, [filtered]);

  // Category view — nested: ONE box per Category 1, with each Category 2
  // as a row inside it (Daksh), and carved slabs left out entirely since
  // nothing there can be acted on.
  const byCategory = useMemo(() => {
    const pending = filtered.filter((s) => s.stage !== "done");
    const m = new Map<string, Map<string, PlanSlab[]>>();
    for (const s of pending) {
      const c1 = (s.section || "").trim() || "— No category —";
      const c2 = (s.element || "").trim() || "—";
      let subs = m.get(c1);
      if (!subs) { subs = new Map(); m.set(c1, subs); }
      const arr = subs.get(c2);
      if (arr) arr.push(s); else subs.set(c2, [s]);
    }
    // not cut → cutted waiting → in carving, then by code inside each
    const byStageThenId = (a: PlanSlab, b: PlanSlab) =>
      STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
      a.id.localeCompare(b.id, undefined, { numeric: true });
    return [...m.entries()]
      .map(([cat1, subMap]) => {
        const subs = [...subMap.entries()]
          .map(([cat2, r]) => ({ cat2, rows: [...r].sort(byStageThenId), cft: r.reduce((a, s) => a + cftOf(s), 0) }))
          .sort((a, b) => b.rows.length - a.rows.length);
        const slabs = subs.reduce((a, s) => a + s.rows.length, 0);
        return { cat1, subs, slabs, cft: subs.reduce((a, s) => a + s.cft, 0) };
      })
      .sort((a, b) => {
        if (a.cat1.startsWith("—")) return 1;
        if (b.cat1.startsWith("—")) return -1;
        return b.slabs - a.slabs;
      });
  }, [filtered]);
  const categoryTotal = useMemo(() => byCategory.reduce((a, g) => a + g.slabs, 0), [byCategory]);

  // Chip totals stay whole-temple (slabs + CFT per route) so the legend
  // keeps meaning while a filter or search is active; effRows so a route
  // change moves the counts instantly.
  const routeStats = useMemo(() => {
    const blank = () => ({ slabs: 0, cft: 0, leftSlabs: 0, leftCft: 0 });
    const c: Record<MethodKey, ReturnType<typeof blank>> = {
      cnc: blank(), outsource: blank(), none: blank(), nil: blank(),
    };
    for (const s of effRows) {
      const cft = cftOf(s);
      c[s.method].slabs += 1;
      c[s.method].cft += cft;
      // "Left" = still to be carved on this route; carved/dispatched slabs
      // are done work, not pending load (Daksh).
      if (s.stage !== "done") { c[s.method].leftSlabs += 1; c[s.method].leftCft += cft; }
    }
    return c;
  }, [effRows]);
  const totalCft = useMemo(() => rows.reduce((a, s) => a + cftOf(s), 0), [rows]);
  const narrowed = q.trim() !== "" || routeFilter !== null;
  const selCft = useMemo(
    () => effRows.reduce((a, s) => (sel.has(s.id) ? a + cftOf(s) : a), 0),
    [effRows, sel],
  );
  const routableShown = useMemo(() => filtered.filter(canRoute), [filtered]);
  const allShownPicked = routableShown.length > 0 && routableShown.every((s) => sel.has(s.id));

  const showTip = (s: PlanSlab, el: HTMLElement) => {
    if (pinnedRef.current) return; // one card at a time — the pinned one wins
    const r = el.getBoundingClientRect();
    const below = r.bottom + 210 < window.innerHeight;
    setTip({
      s,
      x: Math.min(Math.max(r.left + r.width / 2, 145), window.innerWidth - 145),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  };

  const pinSeat = (s: PlanSlab, el: HTMLElement) => {
    setTip(null);
    const r = el.getBoundingClientRect();
    const below = r.bottom + 320 < window.innerHeight;
    setPinned({
      s,
      x: Math.min(Math.max(r.left + r.width / 2, 165), window.innerWidth - 165),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  };

  const tipRow = (label: string, value: string | null) => (
    <div style={{ display: "flex", gap: 8, fontSize: 11, lineHeight: 1.45 }}>
      <span style={{ flexShrink: 0, width: 62, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", fontSize: 9, color: "var(--muted)", paddingTop: 1.5 }}>{label}</span>
      <span style={{ minWidth: 0, color: "var(--text)" }}>{value || "—"}</span>
    </div>
  );

  return (
    // TRUE full screen (Daksh) — covers the sidebar (z 100) and mobile
    // drawer (z 301) so every pixel goes to seats; NavigationProgress
    // (z 10000) stays above.
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "var(--bg)", display: "flex", flexDirection: "column", animation: "planFadeUp .18s ease both" }}>
      {/* header — row 1: temple + totals + close */}
      <div style={{ flexShrink: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "10px 20px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🏛 {temple}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>Seat colour = carving route · corner dot = stage — click a seat to change its route</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <b style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt0(rows.length)}</b>
              <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>slabs</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginLeft: 4 }}>{fmt0(totalCft)} CFT</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 16px", borderRadius: 8, border: "1.5px solid var(--gold-border, #d8c49a)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* row 2: search + route filter chips (with volume, tap to filter) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => { qRef.current = e.target.value; setQ(e.target.value); }}
            placeholder="🔎 Search code, category, label, description, stone, size…"
            style={{ flex: "1 1 220px", maxWidth: 380, padding: "8px 13px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
          />
          {/* view switch — same slabs, cinema rows or category cards */}
          <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg)", flexShrink: 0 }}>
            {([
              { key: "stage", label: "🏗 By stage" },
              { key: "category", label: "🗂 By category" },
            ] as Array<{ key: "stage" | "category"; label: string }>).map((v, i) => {
              const on = groupBy === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setGroupBy(v.key)}
                  style={{
                    fontSize: 12, fontWeight: 800, padding: "8px 13px", cursor: "pointer", border: "none",
                    borderLeft: i === 0 ? "none" : "1px solid var(--border)",
                    background: on ? "var(--gold-dark, #b45309)" : "transparent",
                    color: on ? "#fff" : "var(--muted)",
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
          {METHOD_ORDER.map((mk) => {
            const st = routeStats[mk];
            const th2 = METHOD_THEME[mk];
            const on = routeFilter === mk;
            return (
              <button
                key={mk}
                type="button"
                onClick={() => setRouteFilter(on ? null : mk)}
                title={on ? "Show all routes" : `Show only ${th2.label}`}
                style={{
                  display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
                  fontSize: 11.5, cursor: "pointer", padding: "5px 12px", borderRadius: 10,
                  border: `1.5px solid ${on ? th2.fg : "var(--border)"}`,
                  background: on ? `${mk === "nil" ? "#6b7280" : th2.fg}14` : "var(--bg)",
                  boxShadow: on ? `0 0 0 1px ${th2.fg}` : "none",
                  opacity: st.slabs === 0 && !on ? 0.45 : 1,
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ alignSelf: "center", width: 11, height: 11, borderRadius: 3, background: mk === "nil" ? "var(--bg)" : th2.fg, border: `1.5px solid ${mk === "nil" ? "var(--muted)" : th2.fg}` }} />
                  <span style={{ fontWeight: 700, color: on ? th2.fg : "var(--muted)" }}>{th2.label}</span>
                  <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{fmt0(st.slabs)}</b>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(st.cft)} CFT</span>
                </span>
                {/* how much of that load is still to carve */}
                <span style={{ display: "flex", alignItems: "baseline", gap: 5, paddingLeft: 17, fontSize: 10 }}>
                  <span style={{ fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Left</span>
                  <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: st.leftSlabs > 0 ? "var(--gold-dark, #b45309)" : "var(--muted)" }}>{fmt0(st.leftSlabs)}</b>
                  <span style={{ fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(st.leftCft)} CFT</span>
                </span>
              </button>
            );
          })}
          {narrowed && (
            <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--gold-dark, #b45309)" }}>
              {fmt0(filtered.length)} of {fmt0(rows.length)} shown
            </span>
          )}
          {/* multi-select lives at the far right (Daksh) */}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {multi && routableShown.length > 0 && (
              <button
                type="button"
                onClick={() => setSel((prev) => {
                  const next = new Set(prev);
                  // only slabs that can still be routed
                  if (allShownPicked) { for (const s of routableShown) next.delete(s.id); }
                  else { for (const s of routableShown) next.add(s.id); }
                  return next;
                })}
                style={{ fontSize: 12, fontWeight: 800, padding: "8px 13px", borderRadius: 8, cursor: "pointer", border: "1.5px solid var(--gold-border, #d8c49a)", background: "var(--bg)", color: "var(--gold-dark, #b45309)" }}
              >
                {allShownPicked ? "Untick all" : `Tick all ${fmt0(routableShown.length)} routable`}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMulti((v) => !v); setSel(new Set()); setPinned(null); }}
              title="Pick several seats, then set one route for all of them"
              style={{
                fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                border: `1.5px solid ${multi ? "var(--gold-dark, #b45309)" : "var(--border)"}`,
                background: multi ? "var(--gold-dark, #b45309)" : "var(--bg)",
                color: multi ? "#fff" : "var(--text)",
              }}
            >
              {multi ? "☑ Multi-select on" : "☐ Multi-select"}
            </button>
          </span>
        </div>
      </div>

      {/* seats — full window width, small bezel, so big temples scroll less.
          Clicking empty space dismisses the pinned card (seat clicks stop
          propagation). */}
      <div onScroll={() => { setTip(null); setPinned(null); }} onClick={() => setPinned(null)} style={{ flex: 1, overflowY: "auto", padding: "16px 22px 26px" }}>
        <div>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 0", fontSize: 13.5, fontWeight: 700, color: "var(--muted)" }}>
              No slabs match{q.trim() ? ` “${q.trim()}”` : ""}{routeFilter ? ` in ${METHOD_THEME[routeFilter].label}` : ""}.
              <button
                type="button"
                onClick={() => { qRef.current = ""; setQ(""); setRouteFilter(null); }}
                style={{ display: "block", margin: "12px auto 0", fontSize: 12, fontWeight: 800, padding: "7px 16px", borderRadius: 8, border: "1.5px solid var(--gold-border, #d8c49a)", background: "var(--bg)", color: "var(--gold-dark, #b45309)", cursor: "pointer" }}
              >
                Clear search & filters
              </button>
            </div>
          )}
          {(() => {
            // One seat renderer, two groupings — the section header is the
            // only thing that differs between cinema and category view.
            const seatsOf = (rows2: PlanSlab[]) => (
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: groupBy === "stage" ? "center" : "flex-start", gap: 5 }}>
                {rows2.map((s) => {
                  const routed = s.method !== "nil";
                  const picked = sel.has(s.id);
                  const locked = !canRoute(s);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="plan-seat"
                      onMouseEnter={(e) => showTip(s, e.currentTarget)}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(e) => showTip(s, e.currentTarget)}
                      onBlur={() => setTip(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!multi) { pinSeat(s, e.currentTarget); return; }
                        if (locked) return; // route already executed
                        setSel((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                          return next;
                        });
                      }}
                      style={{
                        position: "relative", width: 56, height: 30, borderRadius: 6, padding: 0,
                        fontFamily: "ui-monospace, monospace", fontSize: 8.5, fontWeight: 800,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        overflow: "hidden", whiteSpace: "nowrap",
                        cursor: multi && locked ? "not-allowed" : "pointer",
                        opacity: multi && locked ? 0.45 : 1,
                        background: routed ? METHOD_THEME[s.method].fg : "var(--surface)",
                        border: `1.5px solid ${routed ? METHOD_THEME[s.method].fg : "var(--border)"}`,
                        color: routed ? "#fff" : "var(--muted)",
                        outline: picked ? "2.5px solid var(--gold-dark, #b45309)" : "none",
                        outlineOffset: picked ? 1 : 0,
                      }}
                    >
                      {picked && (
                        <span style={{ position: "absolute", inset: 0, background: "rgba(180,140,40,0.22)", pointerEvents: "none" }} />
                      )}
                      {seatCode(s.id)}
                      {/* Two facts on one seat (Daksh): the FILL is the
                          carving route, the corner DOT is the production
                          stage. White ring so the dot reads on any fill. */}
                      <span
                        style={{
                          position: "absolute", top: 2, right: 2, width: 6.5, height: 6.5, borderRadius: "50%",
                          background: STAGE_COLOR[s.stage],
                          boxShadow: "0 0 0 1.5px rgba(255,255,255,0.9)",
                          pointerEvents: "none",
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            );

            if (groupBy === "category") {
              if (categoryTotal === 0) {
                return (
                  <div style={{ textAlign: "center", padding: "40px 0", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
                    Nothing pending in this view — every slab here is already carved.
                  </div>
                );
              }
              return (
                <>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                    Carved slabs are not listed here — only work still to be done.
                  </div>
                  {byCategory.map((g) => {
                    // per-stage tally for the whole Category 1
                    const rows2 = g.subs.flatMap((s) => s.rows);
                    const tally = SEAT_SECTIONS.filter((sec) => sec.key !== "done")
                      .map((sec) => ({ ...sec, n: rows2.filter((s) => s.stage === sec.key).length }))
                      .filter((t) => t.n > 0);
                    return (
                      <div key={g.cat1} style={{ marginBottom: 18, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", overflow: "hidden" }}>
                        {/* Category 1 band */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 13px", background: "rgba(180,140,40,0.07)", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--gold-dark, #b45309)", letterSpacing: "0.04em" }}>{g.cat1}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" }}>
                            {fmt0(g.slabs)} slabs
                          </span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{fmt0(g.cft)} CFT</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>· {fmt0(g.subs.length)} section{g.subs.length === 1 ? "" : "s"}</span>
                          <span style={{ flex: 1 }} />
                          {tally.map((t) => (
                            <span key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLOR[t.key] }} />
                              <span style={{ color: "var(--muted)", fontWeight: 700 }}>{t.label}</span>
                              <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt0(t.n)}</b>
                            </span>
                          ))}
                        </div>
                        {/* Category 2 rows nested inside */}
                        {g.subs.map((sub, i) => (
                          <div key={sub.cat2} style={{ padding: "11px 13px 13px", borderTop: i === 0 ? "none" : "10px solid var(--bg)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 7 }}>
                              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)" }}>{sub.cat2}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)" }}>{fmt0(sub.rows.length)} slabs</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{fmt0(sub.cft)} CFT</span>
                            </div>
                            {seatsOf(sub.rows)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              );
            }

            return (
              <>
                {SEAT_SECTIONS.map(({ key, label, hi }) => {
                  const secRows = byStage.get(key)!;
                  if (secRows.length === 0) return null;
                  const secCft = secRows.reduce((a, s) => a + cftOf(s), 0);
                  return (
                    <div key={key} style={{ marginBottom: 22 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: STAGE_COLOR[key] }}>{label}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>/ {hi}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" }}>
                          {fmt0(secRows.length)} slabs
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{fmt0(secCft)} CFT</span>
                        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                      </div>
                      {seatsOf(secRows)}
                    </div>
                  );
                })}

                {/* the "screen" — carved slabs end up here */}
                <div style={{ maxWidth: 560, margin: "26px auto 4px", textAlign: "center" }}>
                  <div style={{ height: 12, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: "linear-gradient(to bottom, var(--gold-dark, #b45309), transparent)", opacity: 0.45 }} />
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", marginTop: 7 }}>
                    🏛 Temple — carved slabs head this way
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* multi-select action bar — one route for the whole selection */}
      {multi && sel.size > 0 && (
        <div style={{ flexShrink: 0, borderTop: "2px solid var(--gold-dark, #b45309)", background: "var(--surface)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", boxShadow: "0 -4px 14px rgba(0,0,0,0.1)" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, fontWeight: 800 }}>
            {fmt0(sel.size)} slab{sel.size === 1 ? "" : "s"} selected
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{fmt0(selCft)} CFT</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>— set route:</span>
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["cnc", "outsource", "none"] as CarvingMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy !== null}
                onClick={() => applyRouteIds([...sel], m)}
                style={{
                  fontSize: 12.5, fontWeight: 800, padding: "8px 15px", borderRadius: 6,
                  border: `1.5px solid ${METHOD_BADGE[m].border}`,
                  background: METHOD_BADGE[m].bg, color: METHOD_BADGE[m].fg,
                  cursor: busy !== null ? "wait" : "pointer",
                }}
              >
                {busy === m ? "Saving…" : METHOD_THEME[m].label}
              </button>
            ))}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => applyRouteIds([...sel], null)}
              style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 15px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: busy !== null ? "wait" : "pointer" }}
            >
              {busy === "nil" ? "Saving…" : "Clear — Nil (any)"}
            </button>
            <button
              type="button"
              onClick={() => setSel(new Set())}
              style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 13px", borderRadius: 6, border: "none", background: "none", color: "var(--muted)", cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* hover card — fixed at overlay root, never inside a transformed seat */}
      {tip && !pinned && (
        <div
          style={{
            position: "fixed", left: tip.x, top: tip.y, zIndex: 510, pointerEvents: "none",
            transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
            width: 280, background: "var(--surface)", border: "1.5px solid var(--gold-border, #d8c49a)",
            borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.22)", padding: "11px 13px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5 }}>
              {tip.s.priority && <span style={{ color: "#f59e0b" }}>⚡ </span>}{tip.s.id}
            </span>
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", borderRadius: 4, padding: "2px 8px", color: tip.s.method === "nil" ? "var(--muted)" : "#fff", background: tip.s.method === "nil" ? "var(--surface-alt, rgba(0,0,0,0.05))" : METHOD_THEME[tip.s.method].fg, border: `1px solid ${tip.s.method === "nil" ? "var(--border)" : METHOD_THEME[tip.s.method].fg}` }}>
              {METHOD_THEME[tip.s.method].label}
            </span>
          </div>
          {tipRow("Status", tip.s.status.replace(/_/g, " "))}
          {tipRow("Size", `${tip.s.l}×${tip.s.w}×${tip.s.t}″ · ${fmt1(cftOf(tip.s))} CFT`)}
          {tipRow("Category", [tip.s.section, tip.s.element].filter(Boolean).join(" › ") || null)}
          {tipRow("Label", tip.s.label)}
          {tipRow("Descr.", tip.s.description)}
          {tipRow("Stone", tip.s.stone)}
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px dashed var(--border)", fontSize: 10, fontWeight: 700, color: "var(--gold-dark, #b45309)" }}>
            {!canRoute(tip.s)
              ? "🔒 Route locked — carving already started"
              : multi ? "Click to add this slab to the selection" : "Click the seat to change its route"}
          </div>
        </div>
      )}

      {/* clicked card — same info, pinned, with route-change buttons */}
      {pinned && (() => {
        const cur = overrides.get(pinned.s.id) ?? pinned.s.method;
        return (
          <div
            style={{
              position: "fixed", left: pinned.x, top: pinned.y, zIndex: 520,
              transform: `translate(-50%, ${pinned.below ? "0" : "-100%"})`,
              width: 310, background: "var(--surface)", border: "1.5px solid var(--gold-border, #d8c49a)",
              borderRadius: 10, boxShadow: "0 16px 44px rgba(0,0,0,0.3)", padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5 }}>
                {pinned.s.priority && <span style={{ color: "#f59e0b" }}>⚡ </span>}{pinned.s.id}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", borderRadius: 4, padding: "2px 8px", color: cur === "nil" ? "var(--muted)" : "#fff", background: cur === "nil" ? "var(--surface-alt, rgba(0,0,0,0.05))" : METHOD_THEME[cur].fg, border: `1px solid ${cur === "nil" ? "var(--border)" : METHOD_THEME[cur].fg}` }}>
                  {METHOD_THEME[cur].label}
                </span>
                <button type="button" onClick={() => setPinned(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "var(--muted)", padding: 2, lineHeight: 1 }}>✕</button>
              </span>
            </div>
            {tipRow("Status", pinned.s.status.replace(/_/g, " "))}
            {tipRow("Size", `${pinned.s.l}×${pinned.s.w}×${pinned.s.t}″ · ${fmt1(cftOf(pinned.s))} CFT`)}
            {tipRow("Category", [pinned.s.section, pinned.s.element].filter(Boolean).join(" › ") || null)}
            {tipRow("Label", pinned.s.label)}
            {tipRow("Descr.", pinned.s.description)}
            {tipRow("Stone", pinned.s.stone)}
            {/* Route is decided before carving — once the slab is on a
                machine or finished, the decision is already executed. */}
            {!canRoute(pinned.s) ? (
              <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                🔒 Route locked — this slab is {pinned.s.stage === "inCarving" ? "already in carving" : "already carved / dispatched"}, so it can&apos;t be re-routed.
              </div>
            ) : (
            <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
                Change route
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["cnc", "outsource", "none"] as CarvingMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={busy !== null || cur === m}
                    onClick={() => applyRouteIds([pinned.s.id], m)}
                    style={{
                      fontSize: 11.5, fontWeight: 800, padding: "6px 11px", borderRadius: 6,
                      border: `1.5px solid ${METHOD_BADGE[m].border}`,
                      background: METHOD_BADGE[m].bg, color: METHOD_BADGE[m].fg,
                      cursor: busy !== null || cur === m ? "default" : "pointer",
                      opacity: cur === m ? 0.45 : 1,
                    }}
                  >
                    {busy === m ? "Saving…" : `${METHOD_THEME[m].label}${cur === m ? " ✓" : ""}`}
                  </button>
                ))}
                {cur !== "nil" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => applyRouteIds([pinned.s.id], null)}
                    style={{ fontSize: 11.5, fontWeight: 800, padding: "6px 11px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: busy !== null ? "default" : "pointer" }}
                  >
                    {busy === "nil" ? "Saving…" : "Clear — Nil (any)"}
                  </button>
                )}
              </div>
            </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export function PlanClient({
  summaries, temples, slabs, forecast,
}: {
  summaries: Record<MethodKey, MethodSummary>;
  temples: TempleMethodRow[];
  slabs: PlanSlab[];
  forecast: CncForecast;
}) {
  const [temple, setTemple] = useState<string>("");
  // Cinema-style seat map, opened from the Total-slabs stat — the one
  // place slabs are listed and re-routed now.
  const [seatOpen, setSeatOpen] = useState(false);

  const templeRow = temples.find((t) => t.temple === temple) ?? null;
  // The slab list is ALWAYS temple-scoped (Daksh) — nothing renders until a
  // temple is picked, so the page never dumps all 9.4k slabs at once.
  const templeSlabs = useMemo(
    () => (temple ? slabs.filter((s) => s.temple === temple) : []),
    [slabs, temple],
  );

  // Temple aggregates for the ring section.
  const tAgg = useMemo(() => {
    if (!templeRow) return null;
    const sum = (f: (m: MethodSummary) => number) => METHOD_ORDER.reduce((a, mk) => a + f(templeRow.methods[mk]), 0);
    const total = { slabs: sum((m) => m.total.slabs), cft: sum((m) => m.total.cft) };
    const stage = (k: keyof StageTotals) => ({ slabs: sum((m) => m.stages[k].slabs), cft: sum((m) => m.stages[k].cft) });
    const done = stage("done");
    const remaining = { slabs: total.slabs - done.slabs, cft: total.cft - done.cft };
    const perRouteRemaining = METHOD_ORDER.map((mk) => {
      const m = templeRow.methods[mk];
      return {
        mk,
        slabs: m.total.slabs - m.stages.done.slabs,
        cft: m.total.cft - m.stages.done.cft,
      };
    }).filter((r) => r.slabs > 0);
    return { total, done, inCarving: stage("inCarving"), cutWaiting: stage("cutWaiting"), notCut: stage("notCut"), remaining, perRouteRemaining };
  }, [templeRow]);

  // Keep the picked temple + open seat map in the URL, so a refresh (or a
  // shared link) lands exactly where you were instead of resetting to the
  // empty logbook (Daksh). Read on mount rather than in a useState
  // initialiser — the server renders this component too, and reading
  // window there would produce a hydration mismatch. history.replaceState
  // keeps it out of the back-stack and skips a router round-trip.
  const urlReadRef = useRef(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("temple");
    // Ignore a temple that no longer exists so a stale link can't wedge
    // the page on an empty selection.
    if (t && temples.some((x) => x.temple === t)) {
      setTemple(t);
      if (p.get("map") === "1") setSeatOpen(true);
    }
    urlReadRef.current = true;
  }, [temples]);

  useEffect(() => {
    if (!urlReadRef.current) return;
    const p = new URLSearchParams(window.location.search);
    if (temple) p.set("temple", temple); else p.delete("temple");
    if (temple && seatOpen) p.set("map", "1"); else p.delete("map");
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [temple, seatOpen]);

  // CNC forecast derived figures.
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
      <style>{`
        @keyframes planFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .plan-card { animation: planFadeUp .3s ease both; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
        .plan-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(45,36,16,0.12); border-color: var(--gold-border, #d8c49a); }
        .plan-pick-row:hover { background: rgba(180,140,40,0.07) !important; }
        @keyframes planZap { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .plan-zap { animation: planZap 1.2s ease-in-out infinite; }
        .plan-seat-btn { all: unset; display: inline-block; cursor: pointer; border-radius: 8px; }
        .plan-seat-btn:hover { box-shadow: 0 0 0 2px var(--gold-border, #d8c49a); animation: none; }
        /* Total slabs opens the seat map — a soft 2s pulse so it reads as a
           button, not a stat. Stops on hover and for reduced-motion users. */
        @keyframes planTapHint {
          0%, 58%, 100% { box-shadow: 0 0 0 0 rgba(180,140,40,0); background: transparent; }
          72%, 86% { box-shadow: 0 0 0 4px rgba(180,140,40,0.45); background: rgba(180,140,40,0.09); }
        }
        .plan-tap-hint { animation: planTapHint 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .plan-tap-hint { animation: none; } }
        .plan-seat { transition: transform .1s ease, box-shadow .1s ease; }
        .plan-seat:hover { transform: scale(1.15); box-shadow: 0 3px 10px rgba(0,0,0,0.25); z-index: 2; }
      `}</style>

      <div className="page-header">
        <h1>CNC Logbook</h1>
      </div>

      {/* ── 1. Per-method headline cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
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
                  {fmt0(done.slabs)} done
                </span>
              </div>
              {/* Ring shows the stage split (% carved in the middle); both
                  totals live together in the footer row below. */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
                <StageDonut
                  stages={s.stages}
                  total={s.total.slabs}
                  centerValue={`${pct(done.slabs, s.total.slabs)}%`}
                  centerUnit="done"
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                  {DONUT_ORDER.map((key) => {
                    const label = STAGE_LABELS.find((x) => x.key === key)!.label;
                    const v = s.stages[key].slabs;
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: STAGE_COLOR[key], flexShrink: 0, opacity: v > 0 ? 1 : 0.3 }} />
                        <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                        {/* volume printed beside every stage count, not just
                            hidden in a hover title */}
                        <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: v > 0 ? "var(--text)" : "var(--muted)" }}>{fmt0(v)}</b>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums", minWidth: 54, textAlign: "right", flexShrink: 0 }}>
                          {fmt0(s.stages[key].cft)} CFT
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Both totals together in one footer — count in ink on the
                  left, volume muted in its own box on the right, so the two
                  kinds of number never read alike. */}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <span>
                  <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>Total slabs</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                    <b style={{ fontSize: 21, fontWeight: 800, lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt0(s.total.slabs)}</b>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>slabs</span>
                  </span>
                </span>
                <span style={{ padding: "5px 11px", borderRadius: 8, background: "var(--surface-alt, rgba(0,0,0,0.035))", border: "1px solid var(--border)" }}>
                  <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>Volume</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 1 }}>
                    <b style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(s.total.cft)}</b>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>cft</span>
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 2. CNC capacity — the cockpit this page exists for ── */}
      <div style={{ ...card, borderLeft: "4px solid #1d4ed8", padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#1d4ed8" }}>
            CNC capacity
          </span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#1d4ed8", background: "rgba(29,78,216,0.08)", border: "1px solid rgba(29,78,216,0.25)", borderRadius: 999, padding: "3px 12px" }}>
            {forecast.machineCount} machines active
          </span>
        </div>

        <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap" }}>
          {/* Pending — what the machines still owe */}
          <div style={{ flex: "1 1 240px", minWidth: 240 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
              Pending CNC work
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 7, flexWrap: "wrap" }}>
              <Stat label="Slabs" value={fmt0(forecast.cncPending.slabs)} unit="slabs" tone="count" />
              <Stat label="Volume" value={fmt0(forecast.cncPending.cft)} unit="cft" tone="volume" size={22} />
            </div>
            {/* Where those pending slabs are, as one stacked bar + legend */}
            {(() => {
              const st = summaries.cnc.stages;
              const segs = [
                { key: "inCarving", label: "On machines", v: st.inCarving.slabs, color: STAGE_COLOR.inCarving },
                { key: "cutWaiting", label: "Cut · waiting", v: st.cutWaiting.slabs, color: STAGE_COLOR.cutWaiting },
                { key: "notCut", label: "Not cut yet", v: st.notCut.slabs, color: STAGE_COLOR.notCut },
              ];
              const tot = segs.reduce((a, s) => a + s.v, 0);
              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {segs.map((s) => (s.v > 0 ? <div key={s.key} style={{ width: `${pct(s.v, tot)}%`, background: s.color }} /> : null))}
                    {tot === 0 && <div style={{ width: "100%", background: "var(--border)" }} />}
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 7 }}>
                    {segs.map((s) => (
                      <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                        <span style={{ color: "var(--muted)" }}>{s.label}</span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt0(s.v)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Pace — hero rate + live 30-day output chart */}
          <div style={{ flex: "1.6 1 320px", minWidth: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                Pace — last 30 days
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                {fmt1(slabsPerDay)} slabs/day · {fmt1(perMachineDay)} CFT/day per machine
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: "#1d4ed8", fontVariantNumeric: "tabular-nums" }}>
                {fmt1(cftPerDay)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                CFT / day
              </span>
            </div>
            {/* Daily carved CFT — today rightmost. Average as a dashed line. */}
            {(() => {
              const max = Math.max(...forecast.daily, 1);
              const avgH = Math.min(100, (cftPerDay / max) * 100);
              return (
                <div style={{ position: "relative", marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 58 }}>
                    {forecast.daily.map((v, i) => (
                      <div
                        key={i}
                        title={`${fmt0(v)} CFT`}
                        style={{
                          flex: 1,
                          height: `${Math.max(v > 0 ? 4 : 1.5, (v / max) * 100)}%`,
                          background: i === forecast.daily.length - 1 ? "var(--gold-dark, #b45309)" : v > 0 ? "#1d4ed8" : "var(--border)",
                          opacity: v > 0 ? (0.45 + 0.55 * (v / max)) : 1,
                          borderRadius: "2px 2px 0 0",
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: `${avgH}%`, borderTop: "1.5px dashed rgba(29,78,216,0.55)", pointerEvents: "none" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <span>30 days ago</span>
                    <span>today</span>
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 10, marginTop: 9, flexWrap: "wrap" }}>
              <Stat label="Carved in 30 days" value={fmt0(forecast.cncDone30.slabs)} unit="slabs" tone="count" size={19} />
              <Stat label="Volume carved" value={fmt0(forecast.cncDone30.cft)} unit="cft" tone="volume" size={17} />
            </div>
          </div>

          {/* Verdict — the answer this card exists to give */}
          {(() => {
            const state =
              daysLeft == null ? "none" : daysLeft < 10 ? "starving" : daysLeft > 60 ? "overload" : "healthy";
            const tone =
              state === "starving" ? { fg: "#b45309", bg: "rgba(180,83,9,0.07)", bd: "rgba(180,83,9,0.35)" } :
              state === "overload" ? { fg: "#b91c1c", bg: "rgba(185,28,28,0.06)", bd: "rgba(185,28,28,0.35)" } :
              state === "healthy" ? { fg: "#15803d", bg: "rgba(21,128,61,0.06)", bd: "rgba(21,128,61,0.35)" } :
              { fg: "var(--muted)", bg: "var(--surface-alt, rgba(0,0,0,0.03))", bd: "var(--border)" };
            return (
              <div style={{ flex: "1 1 220px", minWidth: 220, background: tone.bg, border: `1.5px solid ${tone.bd}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {daysLeft == null ? (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
                    No CNC approvals in the last 30 days — no pace to forecast from.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, color: tone.fg, fontVariantNumeric: "tabular-nums" }}>
                        {fmt0(daysLeft)}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: tone.fg, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.25 }}>
                        days of<br />work left
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginTop: 8 }}>
                      Clears around <b>{clearDate}</b>{" "}at today&apos;s pace.
                    </div>
                    {/* Runway vs one month */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, (daysLeft / 30) * 100)}%`, height: "100%", background: tone.fg, transition: "width .6s ease" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        <span>today</span>
                        <span>{daysLeft > 30 ? `${fmt1(daysLeft / 30)} months` : "1 month"}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {daysLeft != null && daysLeft < 10 && undecidedCutReady > 0 && (
          <div style={{ marginTop: 13, borderRadius: 8, border: "1px solid rgba(180,83,9,0.35)", background: "rgba(180,83,9,0.06)", padding: "9px 13px", fontSize: 12.5, fontWeight: 700, color: "#b45309" }}>
            ⚠ Machines run dry in under {fmt0(Math.max(1, daysLeft))} days — {fmt0(undecidedCutReady)} cut slabs are still undecided; route some to CNC to keep them fed.
          </div>
        )}
        {daysLeft != null && daysLeft > 60 && (
          <div style={{ marginTop: 13, borderRadius: 8, border: "1px solid rgba(185,28,28,0.35)", background: "rgba(185,28,28,0.05)", padding: "9px 13px", fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>
            ⚠ Over {fmt1(daysLeft / 30)} months of CNC backlog — consider moving load to outsource.
          </div>
        )}
      </div>

      {/* ── 3. Temple-wise: our dropdown → rings + remaining + its undecided ── */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "visible" }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderBottom: templeRow ? "1px solid var(--border)" : "none" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, flexShrink: 0 }}>🏛 Temple-wise</span>
          {/* Close the seat map on temple change so it can never show the
              previous temple's slabs. */}
          <TemplePicker temples={temples} value={temple} onPick={(t) => { setTemple(t); setSeatOpen(false); }} />
        </div>

        {templeRow && tAgg && (
          <div style={{ padding: "0 0 6px" }}>
            {/* Two panels (Daksh): LEFT = progress of the whole temple,
                RIGHT = the same work split by carving route. */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
              {/* ── LEFT: rings + totals + work remaining ── */}
              <div style={{ flex: "1.35 1 480px", minWidth: 340, padding: "16px 18px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text)" }}>
                  {templeRow.temple}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  All routes — CNC + Outsource + No carving + Undecided
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "16px 20px", flexWrap: "wrap", marginTop: 12 }}>
                  <Ring
                    value={pct(tAgg.done.slabs, tAgg.total.slabs)}
                    size={116} stroke={12} color={STAGE_COLOR.done}
                    label="Carved / done" sub={`${fmt0(tAgg.done.slabs)} of ${fmt0(tAgg.total.slabs)}`}
                  />
                  <Ring value={pct(tAgg.inCarving.slabs, tAgg.total.slabs)} color={STAGE_COLOR.inCarving} label="In carving" sub={`${fmt0(tAgg.inCarving.slabs)} slabs`} />
                  <Ring value={pct(tAgg.cutWaiting.slabs, tAgg.total.slabs)} color={STAGE_COLOR.cutWaiting} label="Cut · waiting" sub={`${fmt0(tAgg.cutWaiting.slabs)} slabs`} />
                  <Ring value={pct(tAgg.notCut.slabs, tAgg.total.slabs)} color={STAGE_COLOR.notCut} label="Not cut yet" sub={`${fmt0(tAgg.notCut.slabs)} slabs`} />
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Total slabs opens the seat map — every slab as a seat. */}
                  <button type="button" className="plan-seat-btn plan-tap-hint" title="Open the slab seat map" onClick={() => setSeatOpen(true)}>
                    <Stat label="Total slabs ⤢ tap" value={fmt0(tAgg.total.slabs)} unit="slabs" tone="count" />
                  </button>
                  <Stat label="Volume" value={fmt0(tAgg.total.cft)} unit="cft" tone="volume" size={22} />
                </div>
                {/* stacked stage bar */}
                <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 11, border: "1px solid var(--border)" }}>
                  {(["done", "inCarving", "cutWaiting", "notCut"] as Array<keyof StageTotals>).map((k) => {
                    const w = pct(tAgg[k].slabs, tAgg.total.slabs);
                    return w > 0 ? <div key={k} title={`${STAGE_LABELS.find((x) => x.key === k)?.label}`} style={{ width: `${w}%`, background: STAGE_COLOR[k] }} /> : null;
                  })}
                </div>

                {/* work remaining — excludes carved */}
                <div style={{ marginTop: 14, border: "1px solid var(--gold-border, #d8c49a)", background: "rgba(180,140,40,0.06)", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--gold-dark)" }}>
                    Work remaining — carved excluded
                  </span>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Stat label="Slabs left" value={fmt0(tAgg.remaining.slabs)} unit="slabs" tone="count" size={22} />
                    <Stat label="Volume left" value={fmt0(tAgg.remaining.cft)} unit="cft" tone="volume" size={19} />
                  </div>
                </div>
              </div>

              {/* ── RIGHT: the same temple split by route ── */}
              <div style={{ flex: "1 1 330px", minWidth: 300, padding: "16px 18px", borderLeft: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.015))" }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text)" }}>
                  Split by route
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  How much of this temple each route carries, and what is still left on it
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 14px", marginTop: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>Route</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)", textAlign: "right" }}>Total</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)", textAlign: "right" }}>Remaining</span>

                  {METHOD_ORDER.map((mk) => {
                    const m = templeRow.methods[mk];
                    const remain = { slabs: m.total.slabs - m.stages.done.slabs, cft: m.total.cft - m.stages.done.cft };
                    const th2 = METHOD_THEME[mk];
                    const idle = m.total.slabs === 0;
                    return (
                      <div key={mk} style={{ display: "contents" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 0", borderTop: "1px solid var(--border)", minWidth: 0 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 2, background: th2.fg, flexShrink: 0, opacity: idle ? 0.3 : 1 }} />
                          <span style={{ fontSize: 12, fontWeight: 800, color: idle ? "var(--muted)" : th2.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {th2.label}
                          </span>
                        </span>
                        <span style={{ padding: "9px 0", borderTop: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                          <b style={{ fontSize: 14, fontWeight: 800, color: idle ? "var(--muted)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt0(m.total.slabs)}</b>
                          <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(m.total.cft)} CFT</span>
                        </span>
                        <span style={{ padding: "9px 0", borderTop: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                          <b style={{ fontSize: 14, fontWeight: 800, color: remain.slabs > 0 ? "var(--gold-dark, #b45309)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(remain.slabs)}</b>
                          <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(remain.cft)} CFT</span>
                        </span>
                      </div>
                    );
                  })}

                  {/* grand total row */}
                  <span style={{ padding: "9px 0", borderTop: "2px solid var(--border)", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
                    All routes
                  </span>
                  <span style={{ padding: "9px 0", borderTop: "2px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <b style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt0(tAgg.total.slabs)}</b>
                    <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(tAgg.total.cft)} CFT</span>
                  </span>
                  <span style={{ padding: "9px 0", borderTop: "2px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <b style={{ fontSize: 15, fontWeight: 800, color: "var(--gold-dark, #b45309)", fontVariantNumeric: "tabular-nums" }}>{fmt0(tAgg.remaining.slabs)}</b>
                    <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt0(tAgg.remaining.cft)} CFT</span>
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}
      </section>

      {seatOpen && templeRow && (
        <SeatMap temple={templeRow.temple} rows={templeSlabs} onClose={() => setSeatOpen(false)} />
      )}
    </div>
  );
}

