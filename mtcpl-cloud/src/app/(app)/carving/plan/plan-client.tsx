"use client";

// ──────────────────────────────────────────────────────────────────
// Carving Plan — client board (mig 215, round 3 per Daksh):
//   • Method headline cards + ONE deep CNC-capacity card.
//   • Temple section: OUR OWN dropdown (not the browser select) →
//     ring UI (big done-ring + stage rings), a "work remaining —
//     excluding carved" band split by route, and that temple's OWN
//     undecided slabs right underneath.
//   • Global undecided queue below: search across every field,
//     status groups, richer cards, hover-lift life.
//   Selection is shared — tick anywhere, tag from the sticky bar.
//   (No PeekIframe on this page, so hover transforms are safe.)
// ──────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { METHOD_BADGE, methodLabel, type CarvingMethod } from "@/lib/carving-method";
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
const METHOD_THEME: Record<MethodKey, { label: string; fg: string }> = {
  cnc: { label: "CNC", fg: METHOD_BADGE.cnc.fg },
  outsource: { label: "Outsource", fg: METHOD_BADGE.outsource.fg },
  none: { label: "No carving", fg: METHOD_BADGE.none.fg },
  nil: { label: "Undecided", fg: "#6b7280" },
};
const STAGE_LABELS: Array<{ key: keyof StageTotals; label: string }> = [
  { key: "notCut", label: "Not cut yet" },
  { key: "cutWaiting", label: "Cut · waiting" },
  { key: "inCarving", label: "In carving" },
  { key: "done", label: "Done" },
];
const STAGE_COLOR: Record<keyof StageTotals, string> = {
  notCut: "#6b7280",
  cutWaiting: "#0369a1",
  inCarving: "#b45309",
  done: "#15803d",
};
// Everything in this list is undecided by definition — the labels just say
// WHERE the slab is, no "needs a route" nagging, no emoji (Daksh).
const STATUS_GROUPS: Array<{ key: string; label: string; color: string }> = [
  { key: "cut_done", label: "Cut · ready", color: "#0369a1" },
  { key: "cutting", label: "Cutting", color: "#b45309" },
  { key: "planned", label: "Planned for cutting", color: "#7c3aed" },
  { key: "open", label: "Not cut yet", color: "#6b7280" },
  // Reached only by the View all / Already routed modes — undecided slabs
  // never sit in a carving status. Carved/dispatched slabs are filtered out
  // of every mode, so they need no group here.
  { key: "carving_assigned", label: "Carving assigned", color: "#b45309" },
  { key: "carving_in_progress", label: "Carving in progress", color: "#b45309" },
  { key: "carving_on_hold", label: "Carving on hold", color: "#b91c1c" },
];

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

/** Height of the folder tab that carries a card's carving route. */
const TAB_H = 19;

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

/** One undecided slab card — shared by the temple-scoped and global lists. */
function SlabCard({ s, on, onToggle, i, reserveTab }: {
  s: PlanSlab; on: boolean; onToggle: () => void; i: number; reserveTab: boolean;
}) {
  const cats = [s.section, s.element].filter(Boolean).join(" › ");
  const route = s.method !== "nil" ? METHOD_THEME[s.method] : null;
  return (
    <label
      className="plan-card"
      style={{
        position: "relative",
        // Space for the folder tab. Reserved for every card in a list that
        // has any routed slab, so tops stay aligned across the grid.
        marginTop: reserveTab ? TAB_H : 0,
        display: "flex", alignItems: "flex-start", gap: 9,
        border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`,
        background: on ? "rgba(180,140,40,0.10)" : "var(--bg)",
        boxShadow: on ? "0 0 0 2px rgba(180,140,40,0.18)" : "none",
        borderRadius: 6, padding: "9px 11px", cursor: "pointer",
        animationDelay: `${Math.min(i * 14, 280)}ms`,
      }}
    >
      {/* Route rides ABOVE the card like a file-folder tab, so it can never
          be confused with the category chip inside the body (Daksh). */}
      {route && (
        <span
          style={{
            position: "absolute", left: 10, top: -TAB_H, zIndex: 1,
            padding: "2px 10px 4px", lineHeight: 1.35,
            fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
            color: route.fg, background: `${route.fg}1f`,
            border: `1.5px solid ${route.fg}66`, borderBottom: "none",
            borderRadius: "6px 6px 0 0",
          }}
        >
          {route.label}
        </span>
      )}
      <input type="checkbox" checked={on} onChange={onToggle} style={{ cursor: "pointer", marginTop: 2 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.priority && <span className="plan-zap">⚡ </span>}{s.id}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", flexShrink: 0 }}>
            {s.l}×{s.w}×{s.t}″ · {fmt1(cftOf(s))} CFT
          </span>
        </span>
        {/* Category as a chip so it can't be mistaken for the label. */}
        {cats && (
          <span style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", color: "var(--gold-dark)", background: "rgba(180,140,40,0.10)", border: "1px solid rgba(180,140,40,0.30)", borderRadius: 4, padding: "1px 6px", marginTop: 4, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cats}
          </span>
        )}
        {/* Label = bold ink, Description = muted line under it. Always
            rendered (— when the slab genuinely has none) so the card never
            silently drops them. */}
        <span style={{ display: "block", fontSize: 12, fontWeight: 750, color: "var(--text)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.label || "—"}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.description || "—"}
        </span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--muted-light, var(--muted))", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.temple}{s.stone ? ` · ${s.stone}` : ""}
        </span>
      </span>
    </label>
  );
}

/** Status-grouped card list (used scoped-to-temple and globally). */
function StatusGroups({ rows, selected, toggle, toggleAll }: {
  rows: PlanSlab[];
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (rows: PlanSlab[]) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, PlanSlab[]>();
    for (const s of rows) {
      const arr = m.get(s.status) ?? [];
      arr.push(s);
      m.set(s.status, arr);
    }
    const known = STATUS_GROUPS.filter((g) => (m.get(g.key)?.length ?? 0) > 0).map((g) => ({ ...g, rows: m.get(g.key)! }));
    const extras = [...m.entries()]
      .filter(([k]) => !STATUS_GROUPS.some((g) => g.key === k))
      .map(([k, r]) => ({ key: k, label: k.replace(/_/g, " "), color: "#6b7280", rows: r }));
    return [...known, ...extras];
  }, [rows]);

  // Reserve tab space for the whole list (not per card) so a mixed row of
  // routed + undecided cards still lines up along the top.
  const reserveTab = useMemo(() => rows.some((r) => r.method !== "nil"), [rows]);

  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((g) => {
        const ticked = g.rows.filter((r) => selected.has(r.id)).length;
        const allIn = ticked === g.rows.length;
        const cft = g.rows.reduce((a, r) => a + cftOf(r), 0);
        return (
          <div key={g.key}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0 7px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 4, alignSelf: "stretch", background: g.color, borderRadius: 2 }} />
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: g.color }}>
                  {g.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text)", background: "var(--surface-alt, rgba(0,0,0,0.04))", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" }}>
                  {fmt0(g.rows.length)} slabs
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                  {fmt0(cft)} CFT
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleAll(g.rows)}
                style={{ fontSize: 11.5, fontWeight: 800, color: "var(--gold-dark)", background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}
              >
                {allIn ? "Untick all" : `Tick all ${fmt0(g.rows.length)}`}{ticked > 0 && !allIn ? ` (${ticked})` : ""}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8, paddingBottom: 10 }}>
              {g.rows.map((s, i) => (
                <SlabCard key={s.id} s={s} i={i} on={selected.has(s.id)} onToggle={() => toggle(s.id)} reserveTab={reserveTab} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

type ViewMode = "undecided" | "all" | "routed";

export function PlanClient({
  summaries, temples, slabs, forecast,
}: {
  summaries: Record<MethodKey, MethodSummary>;
  temples: TempleMethodRow[];
  slabs: PlanSlab[];
  forecast: CncForecast;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [temple, setTemple] = useState<string>("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<ViewMode>("undecided");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templeRow = temples.find((t) => t.temple === temple) ?? null;
  // The slab list is ALWAYS temple-scoped (Daksh) — nothing renders until a
  // temple is picked, so the page never dumps all 9.4k slabs at once.
  const templeSlabs = useMemo(
    () => (temple ? slabs.filter((s) => s.temple === temple) : []),
    [slabs, temple],
  );

  // Every mode lists PENDING work only. A carved or dispatched slab has no
  // routing decision left — showing it in "Already routed" just filled the
  // view with history you can't act on (Daksh). The finished count is
  // surfaced under the header instead of silently dropped.
  const pendingSlabs = useMemo(() => templeSlabs.filter((s) => s.stage !== "done"), [templeSlabs]);
  const finishedCount = templeSlabs.length - pendingSlabs.length;

  const modeCounts = useMemo(() => ({
    undecided: pendingSlabs.filter((s) => s.method === "nil").length,
    all: pendingSlabs.length,
    routed: pendingSlabs.filter((s) => s.method !== "nil").length,
  }), [pendingSlabs]);

  const modeRows = useMemo(() => {
    if (mode === "all") return pendingSlabs;
    if (mode === "routed") return pendingSlabs.filter((s) => s.method !== "nil");
    return pendingSlabs.filter((s) => s.method === "nil");
  }, [pendingSlabs, mode]);

  // One search across every field the card shows — plus the route name, so
  // "cnc" or "no carving" narrows the list in View all / Already routed.
  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return modeRows;
    return modeRows.filter((s) => {
      const hay = [
        s.id, s.temple, s.label, s.stone, s.description, s.section, s.element,
        s.status.replace(/_/g, " "), METHOD_THEME[s.method].label,
        `${s.l}x${s.w}x${s.t}`, `${s.l}×${s.w}×${s.t}`,
      ].filter(Boolean).join(" · ").toLowerCase();
      return hay.includes(needle);
    });
  }, [modeRows, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(rows: PlanSlab[]) {
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
      `}</style>

      <div className="page-header">
        <h1>Carving Plan</h1>
      </div>

      {/* ── 1. Per-method headline cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(258px, 1fr))", gap: 12 }}>
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
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }} title={`${fmt1(s.stages[key].cft)} CFT`}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: STAGE_COLOR[key], flexShrink: 0, opacity: v > 0 ? 1 : 0.3 }} />
                        <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                        <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: v > 0 ? "var(--text)" : "var(--muted)" }}>{fmt0(v)}</b>
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
          {/* Clear the slab search on temple change — a stale query would
              make the new temple's undecided list look empty. */}
          <TemplePicker temples={temples} value={temple} onPick={(t) => { setTemple(t); setQ(""); }} />
        </div>

        {templeRow && tAgg && (
          <div style={{ padding: "16px 16px 6px" }}>
            {/* rings row */}
            <div style={{ display: "flex", alignItems: "center", gap: "18px 26px", flexWrap: "wrap" }}>
              <Ring
                value={pct(tAgg.done.slabs, tAgg.total.slabs)}
                size={116} stroke={12} color={STAGE_COLOR.done}
                label="Carved / done" sub={`${fmt0(tAgg.done.slabs)} of ${fmt0(tAgg.total.slabs)}`}
              />
              <Ring value={pct(tAgg.inCarving.slabs, tAgg.total.slabs)} color={STAGE_COLOR.inCarving} label="In carving" sub={`${fmt0(tAgg.inCarving.slabs)} slabs`} />
              <Ring value={pct(tAgg.cutWaiting.slabs, tAgg.total.slabs)} color={STAGE_COLOR.cutWaiting} label="Cut · waiting" sub={`${fmt0(tAgg.cutWaiting.slabs)} slabs`} />
              <Ring value={pct(tAgg.notCut.slabs, tAgg.total.slabs)} color={STAGE_COLOR.notCut} label="Not cut yet" sub={`${fmt0(tAgg.notCut.slabs)} slabs`} />
              <div style={{ flex: "1 1 260px", minWidth: 260 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text)" }}>
                  {templeRow.temple}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  All routes — CNC + Outsource + No carving + Undecided
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 7, flexWrap: "wrap" }}>
                  <Stat label="Total slabs" value={fmt0(tAgg.total.slabs)} unit="slabs" tone="count" />
                  <Stat label="Volume" value={fmt0(tAgg.total.cft)} unit="cft" tone="volume" size={22} />
                </div>
                {/* stacked stage bar */}
                <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 10, border: "1px solid var(--border)" }}>
                  {(["done", "inCarving", "cutWaiting", "notCut"] as Array<keyof StageTotals>).map((k) => {
                    const w = pct(tAgg[k].slabs, tAgg.total.slabs);
                    return w > 0 ? <div key={k} title={`${STAGE_LABELS.find((x) => x.key === k)?.label}`} style={{ width: `${w}%`, background: STAGE_COLOR[k] }} /> : null;
                  })}
                </div>
              </div>
            </div>

            {/* work remaining — excludes carved */}
            <div style={{ marginTop: 16, border: "1px solid var(--gold-border, #d8c49a)", background: "rgba(180,140,40,0.06)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--gold-dark)" }}>
                  Work remaining — carved excluded
                </span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Stat label="Slabs left" value={fmt0(tAgg.remaining.slabs)} unit="slabs" tone="count" size={22} />
                  <Stat label="Volume left" value={fmt0(tAgg.remaining.cft)} unit="cft" tone="volume" size={19} />
                </div>
              </div>
              {/* Undecided is dropped here — the section right below is
                  entirely about it, so repeating the chip was noise (Daksh). */}
              {tAgg.perRouteRemaining.filter((r) => r.mk !== "nil").length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {tAgg.perRouteRemaining.filter((r) => r.mk !== "nil").map((r) => (
                    <span key={r.mk} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 11.5, color: METHOD_THEME[r.mk].fg, background: "var(--surface)", border: `1.5px solid ${METHOD_THEME[r.mk].fg}44`, borderRadius: 999, padding: "4px 12px" }}>
                      <b style={{ fontWeight: 800 }}>{METHOD_THEME[r.mk].label}</b>
                      <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt0(r.slabs)}</b>
                      <span style={{ color: "var(--muted)", fontWeight: 700 }}>slabs</span>
                      <span style={{ color: "var(--muted)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>· {fmt0(r.cft)} CFT</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* This temple's slabs — undecided by default, but you can flip
                to every slab or only the already-routed ones and re-route
                from the same cards. */}
            <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 0, border: "1.5px solid var(--border)", borderRadius: 9, overflow: "hidden", background: "var(--bg)" }}>
                  {([
                    { key: "undecided", label: "Undecided", n: modeCounts.undecided },
                    { key: "all", label: "View all", n: modeCounts.all },
                    { key: "routed", label: "Already routed", n: modeCounts.routed },
                  ] as Array<{ key: ViewMode; label: string; n: number }>).map((t, i) => {
                    const on = mode === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => { setMode(t.key); setQ(""); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "8px 15px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                          border: "none", borderLeft: i === 0 ? "none" : "1px solid var(--border)",
                          background: on ? "var(--gold-dark, #b45309)" : "transparent",
                          color: on ? "#fff" : "var(--muted)",
                          transition: "background .15s ease, color .15s ease",
                        }}
                      >
                        {t.label}
                        <span style={{ fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums", padding: "1px 7px", borderRadius: 999, background: on ? "rgba(255,255,255,0.22)" : "var(--surface-alt, rgba(0,0,0,0.05))", color: on ? "#fff" : "var(--text)" }}>
                          {fmt0(t.n)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="🔎 Search code, category, label, stone, route, size…"
                  style={{
                    flex: "1 1 280px", maxWidth: 420, padding: "9px 13px", fontSize: 13,
                    border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)",
                  }}
                />
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 2 }}>
                {mode === "undecided" ? "Undecided in this temple" : mode === "routed" ? "Already routed — tick to change route" : "All pending slabs in this temple"}
                {" — "}{fmt0(filteredRows.length)}
                {q ? ` of ${fmt0(modeRows.length)}` : ""} slab{filteredRows.length === 1 ? "" : "s"}
              </div>
              {finishedCount > 0 && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                  {fmt0(finishedCount)} carved / dispatched slab{finishedCount === 1 ? "" : "s"} not listed — nothing left to route on them.
                </div>
              )}
              {filteredRows.length === 0 ? (
                <div style={{ padding: "10px 0", fontSize: 13, color: "var(--muted)" }}>
                  {q
                    ? `No slabs in this view match “${q}”.`
                    : mode === "undecided"
                      ? "Every pending slab in this temple already has a route — nothing left to decide."
                      : mode === "routed"
                        ? "No pending slab here carries a route yet — everything routed has already been carved or dispatched."
                        : "No pending slabs in this temple."}
                </div>
              ) : (
                <StatusGroups rows={filteredRows} selected={selected} toggle={toggle} toggleAll={toggleAll} />
              )}
            </div>
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

