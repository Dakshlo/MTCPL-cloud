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
export type UndecidedSlab = {
  id: string; temple: string; status: string; label: string | null;
  stone: string | null; description: string | null;
  section: string | null; element: string | null;
  l: number; w: number; t: number; priority: boolean;
};
export type CncForecast = { machineCount: number; cncPending: Tot; cncDone30: Tot };

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
const STATUS_GROUPS: Array<{ key: string; icon: string; label: string; color: string }> = [
  { key: "cut_done", icon: "🪨", label: "Cut · ready — needs a route now", color: "#0369a1" },
  { key: "cutting", icon: "⚙️", label: "Cutting on the machine", color: "#b45309" },
  { key: "planned", icon: "🗓", label: "Planned for cutting", color: "#7c3aed" },
  { key: "open", icon: "▫️", label: "Not cut yet", color: "#6b7280" },
];

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cftOf = (s: UndecidedSlab) => (s.l * s.w * s.t) / 1728;
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
    <div ref={boxRef} style={{ position: "relative", flex: "1 1 340px", maxWidth: 520 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "11px 14px", fontSize: 13.5, fontWeight: 800, textAlign: "left",
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
function SlabCard({ s, on, onToggle, i }: { s: UndecidedSlab; on: boolean; onToggle: () => void; i: number }) {
  const cats = [s.section, s.element].filter(Boolean).join(" › ");
  return (
    <label
      className="plan-card"
      style={{
        display: "flex", alignItems: "flex-start", gap: 9,
        border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`,
        background: on ? "rgba(180,140,40,0.10)" : "var(--bg)",
        boxShadow: on ? "0 0 0 2px rgba(180,140,40,0.18)" : "none",
        borderRadius: 6, padding: "9px 11px", cursor: "pointer",
        animationDelay: `${Math.min(i * 14, 280)}ms`,
      }}
    >
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
}

/** Status-grouped card list (used scoped-to-temple and globally). */
function StatusGroups({ rows, selected, toggle, toggleAll }: {
  rows: UndecidedSlab[];
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (rows: UndecidedSlab[]) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, UndecidedSlab[]>();
    for (const s of rows) {
      const arr = m.get(s.status) ?? [];
      arr.push(s);
      m.set(s.status, arr);
    }
    const known = STATUS_GROUPS.filter((g) => (m.get(g.key)?.length ?? 0) > 0).map((g) => ({ ...g, rows: m.get(g.key)! }));
    const extras = [...m.entries()]
      .filter(([k]) => !STATUS_GROUPS.some((g) => g.key === k))
      .map(([k, r]) => ({ key: k, icon: "•", label: k.replace(/_/g, " "), color: "#6b7280", rows: r }));
    return [...known, ...extras];
  }, [rows]);

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
                <span aria-hidden>{g.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: g.color }}>
                  {g.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text)", background: "var(--surface-alt, rgba(0,0,0,0.04))", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" }}>
                  {fmt0(g.rows.length)} · {fmt0(cft)} CFT
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
                <SlabCard key={s.id} s={s} i={i} on={selected.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

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
  // Undecided is ALWAYS temple-scoped (Daksh) — nothing renders until a
  // temple is picked, so the page never dumps all 5.9k slabs at once.
  const templeUndecided = useMemo(
    () => (temple ? undecided.filter((s) => s.temple === temple) : []),
    [undecided, temple],
  );

  // Search inside the selected temple's undecided pile.
  const filteredUndecided = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return templeUndecided;
    return templeUndecided.filter((s) => {
      const hay = [
        s.id, s.temple, s.label, s.stone, s.description, s.section, s.element,
        s.status.replace(/_/g, " "), `${s.l}x${s.w}x${s.t}`, `${s.l}×${s.w}×${s.t}`,
      ].filter(Boolean).join(" · ").toLowerCase();
      return hay.includes(needle);
    });
  }, [templeUndecided, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(rows: UndecidedSlab[]) {
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

      {/* ── 2. CNC capacity ── */}
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
            ⚠ Machines run dry in under {fmt0(Math.max(1, daysLeft))} days — {fmt0(undecidedCutReady)} cut slabs are still undecided; route some to CNC to keep them fed.
          </div>
        )}
        {daysLeft != null && daysLeft > 60 && (
          <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: "#b45309" }}>
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
              <div style={{ flex: "1 1 220px", minWidth: 220 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>
                  {templeRow.temple}
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, marginTop: 3 }}>
                  {fmt0(tAgg.total.slabs)} <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>slabs</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", marginLeft: 8 }}>{fmt0(tAgg.total.cft)} CFT</span>
                </div>
                {/* stacked stage bar */}
                <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 9, border: "1px solid var(--border)" }}>
                  {(["done", "inCarving", "cutWaiting", "notCut"] as Array<keyof StageTotals>).map((k) => {
                    const w = pct(tAgg[k === "done" ? "done" : k === "inCarving" ? "inCarving" : k === "cutWaiting" ? "cutWaiting" : "notCut"].slabs, tAgg.total.slabs);
                    return w > 0 ? <div key={k} title={`${STAGE_LABELS.find((x) => x.key === k)?.label}`} style={{ width: `${w}%`, background: STAGE_COLOR[k] }} /> : null;
                  })}
                </div>
              </div>
            </div>

            {/* work remaining — excludes carved */}
            <div style={{ marginTop: 16, border: "1px solid var(--gold-border, #d8c49a)", background: "rgba(180,140,40,0.06)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--gold-dark)" }}>
                  🔨 Work remaining (excl. carved)
                </span>
                <span style={{ fontSize: 19, fontWeight: 800 }}>
                  {fmt0(tAgg.remaining.slabs)} <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>slabs</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginLeft: 7 }}>{fmt0(tAgg.remaining.cft)} CFT</span>
                </span>
              </div>
              {tAgg.perRouteRemaining.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
                  {tAgg.perRouteRemaining.map((r) => (
                    <span key={r.mk} style={{ fontSize: 11.5, fontWeight: 800, color: METHOD_THEME[r.mk].fg, background: "var(--surface)", border: `1.5px solid ${METHOD_THEME[r.mk].fg}44`, borderRadius: 999, padding: "4px 12px" }}>
                      {METHOD_THEME[r.mk].label}: {fmt0(r.slabs)} · {fmt0(r.cft)} CFT
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* this temple's undecided, right where the decision is made */}
            {templeUndecided.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                    ❓ Undecided in this temple — {fmt0(filteredUndecided.length)}
                    {q ? ` of ${fmt0(templeUndecided.length)}` : ""} slab{filteredUndecided.length === 1 ? "" : "s"}
                  </span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="🔎 Search code, category, label, stone, size…"
                    style={{
                      flex: "1 1 300px", maxWidth: 440, padding: "9px 13px", fontSize: 13,
                      border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)",
                    }}
                  />
                </div>
                {filteredUndecided.length === 0 ? (
                  <div style={{ padding: "10px 0", fontSize: 13, color: "var(--muted)" }}>
                    No undecided slabs in this temple match “{q}”.
                  </div>
                ) : (
                  <StatusGroups rows={filteredUndecided} selected={selected} toggle={toggle} toggleAll={toggleAll} />
                )}
              </div>
            )}
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

const miniTd: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", padding: "1px 14px 1px 0" };
const miniTdV: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: "1px 0", fontVariantNumeric: "tabular-nums" };
