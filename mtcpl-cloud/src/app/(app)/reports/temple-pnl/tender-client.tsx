"use client";

/**
 * Tender / Price-Breakdown workspace (Daksh, Aug 2026) — the Excel-style
 * costing sheet on the Temple P&L page. Build a named breakdown (a
 * tender you're pricing), add cost groups (Raw Material / Cutting /
 * Carving / Transportation / Installation / …) with line items inside,
 * each line a ₹ amount, a ₹/CFT rate (× the sheet's quantity) or a %
 * (calculated on the ₹ subtotal — the contractor's P&O convention).
 * Totals, share donut and bars update live; everything autosaves.
 *
 * IMPORTANT (learned the hard way — see the nested-component focus bug
 * memory): every editable row component is defined at MODULE level, not
 * inside the workspace component. Nested definitions remount on each
 * render and inputs lose focus after one keystroke.
 *
 * Styling: same pinned light palette + card language as the P&L page
 * and Finance Analysis.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { saveTenderAnalysesAction } from "./tender-actions";
import type { TenderAnalysis, TenderGroup, TenderItem, TenderItemMode } from "./tender-model";

// ── palette (matches pnl-client) ──────────────────────────────────

const C = {
  ink: "#0b1220",
  ink2: "#3f4a5c",
  muted: "#8892a4",
  line: "#e6eaf0",
  paper: "#ffffff",
  wash: "#f6f8fb",
  green: "#0f9d58",
  greenSoft: "rgba(15,157,88,0.10)",
  amber: "#c2740a",
  indigo: "#4f46e5",
  indigoSoft: "rgba(79,70,229,0.10)",
  red: "#c0392b",
  redSoft: "rgba(192,57,43,0.10)",
};

/** Group accent colours, cycled — donut, bars and header dots share them. */
const GROUP_COLORS = ["#4f46e5", "#c2740a", "#0284c7", "#0f9d58", "#7c3aed", "#e11d48", "#0d9488", "#64748b"];

const card: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.line}`,
  borderRadius: 20,
  boxShadow: "0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.05)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: C.muted,
};

// ── helpers ───────────────────────────────────────────────────────

function inr(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const neg = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e7) return `${neg}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${neg}₹${(a / 1e5).toFixed(2)} L`;
  return `${neg}₹${Math.round(a).toLocaleString("en-IN")}`;
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** One item's ₹ contribution. % items resolve against the ₹ subtotal. */
function itemRupees(it: TenderItem, qty: number | null, base: number): number {
  if (it.mode === "amount") return it.value;
  if (it.mode === "per_cft") return it.value * (qty ?? 0);
  return (it.value / 100) * base;
}

/** Sheet economics: base = Σ ₹ items (amount + per_cft); % rows ride on it. */
function computeSheet(a: TenderAnalysis) {
  let base = 0;
  for (const g of a.groups) for (const it of g.items) {
    if (it.mode === "amount") base += it.value;
    else if (it.mode === "per_cft") base += it.value * (a.qty ?? 0);
  }
  const groups = a.groups.map((g, i) => {
    const total = g.items.reduce((s, it) => s + itemRupees(it, a.qty, base), 0);
    return { id: g.id, title: g.title || "Untitled", total, color: GROUP_COLORS[i % GROUP_COLORS.length] };
  });
  const pctAdd = groups.reduce((s, g) => s + g.total, 0) - base;
  const grand = base + pctAdd;
  return { base, pctAdd, grand, groups, perCft: a.qty && a.qty > 0 ? grand / a.qty : null };
}

/** Fresh sheets. Their exact group list; the rate-card variant lands
 *  pre-filled from the live P&L window. `pace` is the window's REAL
 *  cutting pace (CFT/day) — the timeline's data-driven default. */
export type RateSeed = { stone: number; cutting: number; carving: number; label: string; pace: number | null };

const STARTER_GROUPS = ["Raw Material", "Cutting", "Carving", "Transportation", "Installation", "Other Expenses"];

function blankSheet(): TenderAnalysis {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: "New project",
    qty: null,
    paceCftPerDay: null,
    manualDays: null,
    createdAt: now,
    updatedAt: now,
    groups: STARTER_GROUPS.map((title) => ({ id: uid(), title, items: [{ id: uid(), title: "", mode: "amount" as TenderItemMode, value: 0 }] })),
  };
}

/** The sheet's timeline. Manual days win; otherwise qty ÷ pace, where
 *  pace = the sheet's override or the live data pace. */
function computeTimeline(a: TenderAnalysis, dataPace: number | null) {
  const pace = a.paceCftPerDay ?? dataPace;
  const derived = a.qty && pace && pace > 0 ? a.qty / pace : null;
  const days = a.manualDays ?? derived;
  return {
    days,
    pace,
    source: (a.manualDays != null ? "manual" : a.paceCftPerDay != null ? "custom pace" : "data pace") as "manual" | "custom pace" | "data pace",
    finish: days != null ? new Date(Date.now() + days * 86400000) : null,
  };
}

function seededSheet(seed: RateSeed): TenderAnalysis {
  const a = blankSheet();
  a.name = "New project (from rate card)";
  a.qty = 1000;
  const put = (groupTitle: string, items: Array<Partial<TenderItem>>) => {
    const g = a.groups.find((x) => x.title === groupTitle);
    if (g) g.items = items.map((it) => ({ id: uid(), title: it.title ?? "", mode: it.mode ?? "amount", value: it.value ?? 0 }));
  };
  put("Raw Material", [{ title: `Stone (rate card · ${seed.label})`, mode: "per_cft", value: Math.round(seed.stone) }]);
  put("Cutting", [{ title: `Cutting cost (rate card)`, mode: "per_cft", value: Math.round(seed.cutting) }]);
  put("Carving", [{ title: `Carving cost (rate card)`, mode: "per_cft", value: Math.round(seed.carving) }]);
  put("Other Expenses", [
    { title: "Overheads", mode: "percent", value: 5 },
    { title: "Profit margin", mode: "percent", value: 15 },
  ]);
  return a;
}

// ── module-level row components (focus-safe) ──────────────────────

const cellInput: React.CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 13,
  color: C.ink,
  background: "transparent",
  outline: "none",
  width: "100%",
  fontWeight: 600,
};

function ItemRow({
  item, qty, base, color, autoFocusTitle,
  onChange, onDelete, onEnter,
}: {
  item: TenderItem;
  qty: number | null;
  base: number;
  color: string;
  autoFocusTitle: boolean;
  onChange: (patch: Partial<TenderItem>) => void;
  onDelete: () => void;
  onEnter: () => void;
}) {
  const rupees = itemRupees(item, qty, base);
  return (
    <div className="tn-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px 130px 110px 30px", alignItems: "center", gap: 8, padding: "2px 6px", borderRadius: 10 }}>
      <input
        style={cellInput}
        className="tn-cell"
        placeholder="Line item…"
        value={item.title}
        autoFocus={autoFocusTitle}
        onChange={(e) => onChange({ title: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
      />
      <select
        value={item.mode}
        onChange={(e) => onChange({ mode: e.target.value as TenderItemMode })}
        style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 6px", background: C.wash, outline: "none", cursor: "pointer" }}
      >
        <option value="amount">₹ fixed</option>
        <option value="per_cft">₹ / CFT</option>
        <option value="percent">% of ₹</option>
      </select>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.muted, fontWeight: 700 }}>
          {item.mode === "percent" ? "%" : "₹"}
        </span>
        <input
          style={{ ...cellInput, paddingLeft: 24, textAlign: "right", fontVariantNumeric: "tabular-nums", border: `1px solid ${C.line}`, background: C.paper }}
          className="tn-cell"
          type="number"
          min={0}
          step="any"
          value={item.value === 0 ? "" : item.value}
          placeholder="0"
          onChange={(e) => onChange({ value: Number(e.target.value) || 0 })}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
        />
      </div>
      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: rupees > 0 ? C.ink2 : C.muted, fontVariantNumeric: "tabular-nums" }}>
        {rupees > 0 ? inr(rupees) : "—"}
        {item.mode === "per_cft" && qty == null && (
          <span title="Set the project CFT above for ₹/CFT lines to count." style={{ marginLeft: 4, color: C.amber }}>⚠</span>
        )}
      </div>
      <button type="button" className="tn-del" onClick={onDelete} title="Remove line"
        style={{ border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14, borderRadius: 8, padding: "4px 6px", justifySelf: "center" }}>
        ✕
      </button>
      <span aria-hidden style={{ display: "none" }}>{color}</span>
    </div>
  );
}

function GroupCard({
  group, index, qty, base, grand, focusItemId,
  onTitle, onItemChange, onItemDelete, onAddItem, onDelete,
}: {
  group: TenderGroup;
  index: number;
  qty: number | null;
  base: number;
  grand: number;
  focusItemId: string | null;
  onTitle: (t: string) => void;
  onItemChange: (itemId: string, patch: Partial<TenderItem>) => void;
  onItemDelete: (itemId: string) => void;
  onAddItem: () => void;
  onDelete: () => void;
}) {
  const color = GROUP_COLORS[index % GROUP_COLORS.length];
  const total = group.items.reduce((s, it) => s + itemRupees(it, qty, base), 0);
  const share = grand > 0 ? (total / grand) * 100 : 0;
  return (
    <div className="tn-group" style={{ border: `1px solid ${C.line}`, borderLeft: `3px solid ${color}`, borderRadius: 14, background: C.paper, overflow: "hidden", boxShadow: "0 1px 2px rgba(11,18,32,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px 9px", background: `linear-gradient(180deg, ${color}0d, transparent)`, borderBottom: `1px solid ${C.line}` }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, boxShadow: `0 0 0 3px ${color}22`, flexShrink: 0 }} />
        <input
          style={{ ...cellInput, fontWeight: 800, fontSize: 13.5, padding: "5px 8px", letterSpacing: "-0.01em" }}
          className="tn-cell"
          placeholder="Group heading…"
          value={group.title}
          onChange={(e) => onTitle(e.target.value)}
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(total)}</span>
          {share > 0 && (
            <span style={{ fontSize: 10, fontWeight: 800, color, background: `${color}14`, borderRadius: 999, padding: "2.5px 8px", fontVariantNumeric: "tabular-nums" }}>
              {share.toFixed(0)}%
            </span>
          )}
        </div>
        <button type="button" className="tn-del" onClick={onDelete} title="Remove group"
          style={{ border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, borderRadius: 8, padding: "3px 6px" }}>
          ✕
        </button>
      </div>
      {/* Column ruler — the sheet reads like a real worksheet. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px 130px 110px 30px", gap: 8, padding: "6px 14px 4px", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.11em", color: "#b6bdc9" }}>
        <span>ITEM</span><span>BASIS</span><span style={{ textAlign: "right" }}>VALUE</span><span style={{ textAlign: "right" }}>AMOUNT</span><span />
      </div>
      <div style={{ padding: "0 8px 7px", display: "flex", flexDirection: "column", gap: 1 }}>
        {group.items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            qty={qty}
            base={base}
            color={color}
            autoFocusTitle={focusItemId === it.id}
            onChange={(patch) => onItemChange(it.id, patch)}
            onDelete={() => onItemDelete(it.id)}
            onEnter={onAddItem}
          />
        ))}
        <button
          type="button"
          onClick={onAddItem}
          className="tn-addline"
          style={{ alignSelf: "flex-start", margin: "5px 6px 3px", fontSize: 11.5, fontWeight: 700, color: C.indigo, border: "none", background: "transparent", cursor: "pointer", padding: "3px 8px", borderRadius: 8 }}
        >
          ＋ line <span style={{ fontSize: 9.5, color: "#b6bdc9", fontWeight: 600 }}>· Enter bhi chalega</span>
        </button>
      </div>
    </div>
  );
}

/** SVG share donut — segments over a wash track, centre shows total. */
function Donut({ groups, grand }: { groups: Array<{ id: string; title: string; total: number; color: string }>; grand: number }) {
  const R = 44, CIRC = 2 * Math.PI * R;
  let acc = 0;
  const segs = groups.filter((g) => g.total > 0);
  return (
    <svg width={120} height={120} viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
      <circle cx={60} cy={60} r={R} fill="none" stroke={C.wash} strokeWidth={15} />
      {grand > 0 && segs.map((g) => {
        const frac = g.total / grand;
        const el = (
          <circle
            key={g.id}
            cx={60} cy={60} r={R} fill="none"
            stroke={g.color} strokeWidth={15}
            strokeDasharray={`${Math.max(0.5, frac * CIRC - 1.5)} ${CIRC}`}
            strokeDashoffset={-acc * CIRC}
            transform="rotate(-90 60 60)"
            strokeLinecap="butt"
          />
        );
        acc += frac;
        return el;
      })}
      <text x={60} y={56} textAnchor="middle" style={{ fontSize: 13, fontWeight: 800, fill: C.ink }}>{inr(grand)}</text>
      <text x={60} y={71} textAnchor="middle" style={{ fontSize: 8.5, fontWeight: 700, fill: C.muted, letterSpacing: "0.06em" }}>TOTAL</text>
    </svg>
  );
}

// ── the workspace ─────────────────────────────────────────────────

export function TenderClient({ initial, seed }: { initial: TenderAnalysis[]; seed: RateSeed }) {
  const [sheets, setSheets] = useState<TenderAnalysis[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");

  // Debounced full-snapshot autosave — mirror in a ref so the timer
  // always saves the LATEST state (same-tick race lesson from the
  // planner dials).
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutate = (fn: (prev: TenderAnalysis[]) => TenderAnalysis[]) => {
    setSheets(fn);
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaveState("saving");
      const res = await saveTenderAnalysesAction(sheetsRef.current);
      setSaveState(res.ok ? "saved" : "error");
    }, 900);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const active = sheets.find((s) => s.id === activeId) ?? null;
  const calc = useMemo(() => (active ? computeSheet(active) : null), [active]);
  const timeline = useMemo(() => (active ? computeTimeline(active, seed.pace) : null), [active, seed.pace]);

  const patchActive = (fn: (a: TenderAnalysis) => TenderAnalysis) =>
    mutate((prev) => prev.map((s) => (s.id === activeId ? fn(s) : s)));

  const addSheet = (fromRateCard: boolean) => {
    const a = fromRateCard ? seededSheet(seed) : blankSheet();
    mutate((prev) => [a, ...prev]);
    setActiveId(a.id);
  };

  const addItem = (groupId: string) => {
    const it: TenderItem = { id: uid(), title: "", mode: "amount", value: 0 };
    setFocusItemId(it.id);
    patchActive((a) => ({ ...a, groups: a.groups.map((g) => (g.id === groupId ? { ...g, items: [...g.items, it] } : g)) }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* ── rail: sheet list ── */}
      <div style={{ ...card, padding: "16px 14px", position: "sticky", top: 14 }}>
        <div style={{ ...eyebrow, margin: "0 6px 10px" }}>Your breakdowns</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <button type="button" onClick={() => addSheet(false)} style={railBtn(true)}>＋ New blank sheet</button>
          <button type="button" onClick={() => addSheet(true)} style={railBtn(false)} title={`Raw material / cutting / carving pre-filled from the ${seed.label} rate card`}>
            ⚡ New from rate card
          </button>
        </div>
        <div style={{ height: 1, background: C.line, margin: "13px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "58vh", overflowY: "auto" }}>
          {sheets.length === 0 && (
            <div style={{ fontSize: 12, color: C.muted, padding: "4px 6px", lineHeight: 1.6 }}>
              Nothing yet — start a sheet and price your first tender.
            </div>
          )}
          {sheets.map((sh) => {
            const c = computeSheet(sh);
            const isActive = sh.id === activeId;
            return (
              <div
                key={sh.id}
                className="tn-sheet"
                onClick={() => setActiveId(sh.id)}
                style={{
                  padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                  border: `1px solid ${isActive ? C.indigo : C.line}`,
                  background: isActive ? C.indigoSoft : C.paper,
                  boxShadow: isActive ? `inset 0 0 0 1px ${C.indigo}` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sh.name || "Untitled"}
                  </span>
                  <span
                    className="tn-del"
                    title="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation();
                      const copy: TenderAnalysis = JSON.parse(JSON.stringify(sh));
                      copy.id = uid();
                      copy.name = `${sh.name} (copy)`;
                      copy.groups.forEach((g) => { g.id = uid(); g.items.forEach((it) => { it.id = uid(); }); });
                      mutate((prev) => [copy, ...prev]);
                      setActiveId(copy.id);
                    }}
                    style={{ marginLeft: "auto", fontSize: 12, color: C.muted, cursor: "copy" }}
                  >⧉</span>
                  <span
                    className="tn-del"
                    title="Delete sheet"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete "${sh.name}" permanently?`)) return;
                      mutate((prev) => prev.filter((x) => x.id !== sh.id));
                      if (activeId === sh.id) setActiveId(null);
                    }}
                    style={{ fontSize: 12, color: C.muted, cursor: "pointer" }}
                  >✕</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                  {inr(c.grand)}{c.perCft != null && <> · ₹{Math.round(c.perCft).toLocaleString("en-IN")}/CFT</>}
                </div>
                {/* Whisper-thin share bar — each sheet's cost mix at a glance. */}
                {c.grand > 0 && (
                  <div style={{ display: "flex", height: 3.5, borderRadius: 999, overflow: "hidden", background: C.wash, marginTop: 7 }}>
                    {c.groups.filter((g) => g.total > 0).map((g) => (
                      <div key={g.id} style={{ width: `${(g.total / c.grand) * 100}%`, background: g.color }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Save state — a live status pill, like it's watching over you. */}
        <div style={{ marginTop: 13, display: "flex", justifyContent: "flex-end" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", borderRadius: 999, padding: "4px 11px", color: saveState === "error" ? C.red : saveState === "saving" || saveState === "dirty" ? C.amber : C.green, background: saveState === "error" ? C.redSoft : saveState === "saving" || saveState === "dirty" ? "rgba(194,116,10,0.1)" : C.greenSoft }}>
            <span className={saveState === "saving" || saveState === "dirty" ? "tn-pulse" : undefined} style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
            {saveState === "saving" ? "SAVING" : saveState === "dirty" ? "EDITING" : saveState === "error" ? "SAVE FAILED — EDIT TO RETRY" : "AUTOSAVED"}
          </span>
        </div>
      </div>

      {/* ── workspace ── */}
      {!active || !calc ? (
        <div className="tn-reveal" style={{ ...card, padding: "64px 30px 58px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div aria-hidden style={{ position: "absolute", top: -90, left: "50%", transform: "translateX(-50%)", width: 340, height: 280, background: `radial-gradient(ellipse, ${C.indigoSoft}, transparent 70%)` }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 40, filter: "drop-shadow(0 6px 14px rgba(79,70,229,0.25))" }}>🧮</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginTop: 10, letterSpacing: "-0.02em" }}>Price a tender like you mean it</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.7 }}>
              Groups → lines → live totals, share charts and a delivery timeline from your real pace.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
              {[
                { n: "1", t: "Start a sheet", d: "blank, or seeded from the rate card" },
                { n: "2", t: "Fill the lines", d: "₹ fixed · ₹/CFT · % of subtotal" },
                { n: "3", t: "Read the quote", d: "total, ₹/CFT, split, timeline" },
              ].map((s) => (
                <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 9, border: `1px solid ${C.line}`, background: C.wash, borderRadius: 12, padding: "9px 14px" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.indigo, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
                  <span style={{ textAlign: "left" }}>
                    <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: C.ink }}>{s.t}</span>
                    <span style={{ display: "block", fontSize: 10, color: C.muted }}>{s.d}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Sheet header: name + qty. The gradient keyline on top is the
              workspace's signature — the cost-stream colours in one strip. */}
          <div className="tn-reveal" style={{ ...card, padding: "15px 20px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.indigo}, #0284c7, ${C.green}, ${C.amber})` }} />
            <input
              className="tn-cell"
              style={{ ...cellInput, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", flex: "1 1 260px", minWidth: 200 }}
              value={active.name}
              placeholder="Project / tender name…"
              onChange={(e) => patchActive((a) => ({ ...a, name: e.target.value }))}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
              Project quantity
              <input
                className="tn-cell"
                type="number"
                min={0}
                step="any"
                placeholder="—"
                value={active.qty ?? ""}
                onChange={(e) => patchActive((a) => ({ ...a, qty: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
                style={{ ...cellInput, width: 110, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
              />
              <span style={{ color: C.muted }}>CFT</span>
            </label>
            {/* Timeline inputs — pace defaults to the LIVE data pace
                (placeholder); typing a value overrides it. Typing days
                directly pins the timeline (manual wins over both). */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
              Pace
              <input
                className="tn-cell"
                type="number"
                min={0}
                step="any"
                placeholder={seed.pace != null ? String(Math.round(seed.pace)) : "—"}
                title={seed.pace != null ? `Blank = your real pace from the P&L window (${Math.round(seed.pace)} CFT/day)` : "No data pace for this window — enter your own"}
                value={active.paceCftPerDay ?? ""}
                onChange={(e) => patchActive((a) => ({ ...a, paceCftPerDay: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
                style={{ ...cellInput, width: 88, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
              />
              <span style={{ color: C.muted }}>CFT/day</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
              Time
              <input
                className="tn-cell"
                type="number"
                min={0}
                step="any"
                placeholder={timeline?.days != null && active.manualDays == null ? String(Math.ceil(timeline.days)) : "—"}
                title="Blank = calculated from quantity ÷ pace. Type to fix the timeline manually."
                value={active.manualDays ?? ""}
                onChange={(e) => patchActive((a) => ({ ...a, manualDays: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
                style={{ ...cellInput, width: 84, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
              />
              <span style={{ color: C.muted }}>days</span>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 330px", gap: 14, alignItems: "start" }}>
            {/* Groups worksheet */}
            <div style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
              {active.groups.map((g, gi) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  index={gi}
                  qty={active.qty}
                  base={calc.base}
                  grand={calc.grand}
                  focusItemId={focusItemId}
                  onTitle={(t) => patchActive((a) => ({ ...a, groups: a.groups.map((x) => (x.id === g.id ? { ...x, title: t } : x)) }))}
                  onItemChange={(itemId, patch) =>
                    patchActive((a) => ({
                      ...a,
                      groups: a.groups.map((x) =>
                        x.id === g.id ? { ...x, items: x.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) } : x,
                      ),
                    }))
                  }
                  onItemDelete={(itemId) =>
                    patchActive((a) => ({ ...a, groups: a.groups.map((x) => (x.id === g.id ? { ...x, items: x.items.filter((it) => it.id !== itemId) } : x)) }))
                  }
                  onAddItem={() => addItem(g.id)}
                  onDelete={() => {
                    const hasValues = g.items.some((it) => it.value > 0 || it.title.trim());
                    if (hasValues && !window.confirm(`Remove "${g.title || "this group"}" and its ${g.items.length} line(s)?`)) return;
                    patchActive((a) => ({ ...a, groups: a.groups.filter((x) => x.id !== g.id) }));
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => patchActive((a) => ({ ...a, groups: [...a.groups, { id: uid(), title: "", items: [{ id: uid(), title: "", mode: "amount", value: 0 }] }] }))}
                style={{ alignSelf: "flex-start", fontSize: 12.5, fontWeight: 800, color: C.indigo, background: C.indigoSoft, border: `1px dashed ${C.indigo}55`, borderRadius: 12, padding: "10px 18px", cursor: "pointer" }}
              >
                ＋ Add group
              </button>
            </div>

            {/* Summary — sticky. The COMMAND PANEL: one dark card carrying
                the whole quote — value, unit rate, split line, timeline —
                deliberately the only dark thing on the page. */}
            <div style={{ position: "sticky", top: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="tn-dark tn-reveal" style={{ borderRadius: 20, padding: "20px 22px", position: "relative", overflow: "hidden", background: "linear-gradient(145deg, #0b1220 0%, #131c30 55%, #182441 100%)", boxShadow: "0 18px 44px rgba(11,18,32,0.35), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                {/* glow accents */}
                <div aria-hidden style={{ position: "absolute", top: -70, right: -60, width: 210, height: 210, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.35), transparent 65%)" }} />
                <div aria-hidden style={{ position: "absolute", bottom: -80, left: -50, width: 190, height: 190, borderRadius: "50%", background: "radial-gradient(circle, rgba(2,132,199,0.22), transparent 65%)" }} />
                <div style={{ position: "relative" }}>
                  <div style={{ ...eyebrow, color: "rgba(255,255,255,0.55)" }}>Tender value</div>
                  <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.035em", color: "#fff", fontVariantNumeric: "tabular-nums", marginTop: 7, lineHeight: 1 }}>
                    {inr(calc.grand)}
                  </div>
                  {calc.perCft != null && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, fontWeight: 800, color: "#c7d2fe", background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.35)", borderRadius: 999, padding: "4px 12px", fontVariantNumeric: "tabular-nums" }}>
                      ₹{Math.round(calc.perCft).toLocaleString("en-IN")}/CFT
                      <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>· {active.qty?.toLocaleString("en-IN")} CFT</span>
                    </span>
                  )}

                  {/* stat grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                    <DarkStat label="₹ lines" value={inr(calc.base)} />
                    <DarkStat label="% lines add" value={inr(calc.pctAdd)} hint="% lines are calculated on the ₹ subtotal" />
                    {timeline?.days != null ? (
                      <>
                        <DarkStat
                          label="⏱ Timeline"
                          value={`≈ ${Math.ceil(timeline.days).toLocaleString("en-IN")} days`}
                          sub={`${(timeline.days / 30.44).toFixed(1)} months · ${
                            timeline.source === "manual"
                              ? `manual${active.qty != null && timeline.days > 0 ? `, ${Math.round(active.qty / timeline.days).toLocaleString("en-IN")} CFT/day` : ""}`
                              : `${Math.round(timeline.pace ?? 0).toLocaleString("en-IN")} CFT/day${timeline.source === "data pace" ? " (real pace)" : ""}`
                          }`}
                        />
                        <DarkStat
                          label="Est. finish"
                          value={timeline.finish ? timeline.finish.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—"}
                          sub="starting today"
                        />
                      </>
                    ) : (
                      <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                        ⏱ Set the <strong style={{ color: "rgba(255,255,255,0.85)" }}>project quantity</strong>
                        {seed.pace != null && <> (real pace ~{Math.round(seed.pace)} CFT/day)</>} or type the days — the timeline lands here.
                      </div>
                    )}
                  </div>

                  {/* Month ruler on dark */}
                  {timeline?.days != null && timeline.days > 0 && timeline.days < 3700 && (
                    <div style={{ display: "flex", gap: 3, marginTop: 13 }}>
                      {Array.from({ length: Math.min(24, Math.max(1, Math.ceil(timeline.days / 30.44))) }, (_, i) => {
                        const monthsTotal = (timeline.days ?? 0) / 30.44;
                        const fill = Math.max(0, Math.min(1, monthsTotal - i));
                        return (
                          <div key={i} title={`Month ${i + 1}`} style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                            <div style={{ width: `${fill * 100}%`, height: "100%", background: "linear-gradient(90deg, #818cf8, #38bdf8)" }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ ...card, padding: "18px 20px" }}>
                <div style={{ ...eyebrow, marginBottom: 12 }}>Where the money goes</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Donut groups={calc.groups} grand={calc.grand} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                    {calc.groups.filter((g) => g.total > 0).map((g) => (
                      <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2.5, background: g.color, flexShrink: 0 }} />
                        <span style={{ color: C.ink2, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
                        <span style={{ marginLeft: "auto", color: C.muted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                          {calc.grand > 0 ? `${((g.total / calc.grand) * 100).toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    ))}
                    {calc.grand <= 0 && <div style={{ fontSize: 11.5, color: C.muted }}>Add values to see the split.</div>}
                  </div>
                </div>
                {/* Stacked share bar */}
                {calc.grand > 0 && (
                  <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: C.wash, marginTop: 13 }}>
                    {calc.groups.filter((g) => g.total > 0).map((g) => (
                      <div key={g.id} style={{ width: `${(g.total / calc.grand) * 100}%`, background: g.color }} title={`${g.title} ${inr(g.total)}`} />
                    ))}
                  </div>
                )}
                {/* Per-group bars */}
                {calc.grand > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 13 }}>
                    {calc.groups.filter((g) => g.total > 0).map((g) => {
                      const max = Math.max(...calc.groups.map((x) => x.total), 1);
                      return (
                        <div key={g.id}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.muted, marginBottom: 2.5 }}>
                            <span style={{ fontWeight: 700, color: C.ink2 }}>{g.title}</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{inr(g.total)}</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                            <div style={{ width: `${(g.total / max) * 100}%`, height: "100%", borderRadius: 999, background: g.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
.tn-cell:focus { border-color: ${C.indigo} !important; background: #fff !important; box-shadow: 0 0 0 3px ${C.indigoSoft}; }
.tn-cell::placeholder { color: #b6bdc9; font-weight: 500; }
.tn-row .tn-del, .tn-sheet .tn-del { opacity: 0; transition: opacity .12s; }
.tn-row:hover .tn-del, .tn-sheet:hover .tn-del { opacity: 1; }
.tn-row { transition: background .12s; }
.tn-row:hover { background: ${C.wash}; }
.tn-del:hover { color: ${C.red} !important; }
.tn-group { transition: box-shadow .18s, transform .18s; }
.tn-group:focus-within { box-shadow: 0 10px 30px rgba(11,18,32,0.09); }
.tn-sheet { transition: transform .14s, box-shadow .14s; }
.tn-sheet:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(11,18,32,0.08); }
.tn-addline:hover { background: ${C.indigoSoft}; }
.tn-reveal { animation: tnReveal .45s cubic-bezier(.22,1,.36,1) both; }
@keyframes tnReveal { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: none } }
.tn-pulse { animation: tnPulse 1.1s ease-in-out infinite; }
@keyframes tnPulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
input[type=number].tn-cell::-webkit-outer-spin-button, input[type=number].tn-cell::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
`,
        }}
      />
    </div>
  );
}

/** One cell of the command panel's stat grid. */
function DarkStat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div title={hint} style={hint ? { cursor: "help" } : undefined}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", marginTop: 3, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

const railBtn = (primary: boolean): React.CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 800,
  padding: "9px 13px",
  borderRadius: 11,
  cursor: "pointer",
  textAlign: "left",
  border: primary ? "none" : `1px dashed ${C.indigo}66`,
  background: primary ? C.indigo : C.indigoSoft,
  color: primary ? "#fff" : C.indigo,
});
