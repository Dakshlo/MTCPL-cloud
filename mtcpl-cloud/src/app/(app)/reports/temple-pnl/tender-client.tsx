"use client";

/**
 * Tender / Price-Breakdown workspace (Daksh, Aug 2026) — the Excel-style
 * costing sheet on the Temple P&L page. Build a named breakdown (a tender
 * you're pricing), add cost groups with line items inside, each line a ₹
 * amount, a ₹/unit rate (× the sheet's quantity) or a % (calculated on the ₹
 * subtotal — the contractor's P&O convention). Totals, share donut and bars
 * update live; everything autosaves.
 *
 * Aug 2026 (Daksh) — three changes after the first real use:
 *
 *   • LAYOUT. The old three-column squeeze (rail 290 + sheet + summary 330)
 *     left ~570px for the worksheet on a laptop and read as congested. The
 *     summary is now a full-width command STRIP above the sheet, the rail
 *     collapses, and group cards flow in a responsive grid — so the sheet
 *     gets the whole page and two columns of groups on a wide screen.
 *
 *   • QUOTATION DEFAULTS. "New from rate card" now lands with the company's
 *     own 14 quotation particulars already grouped and titled (scaffolding,
 *     cut size material, carving, packaging, transportation, installation,
 *     …), with the three rate-card lines priced. Nobody retypes the sheet.
 *
 *   • VERSIONS. Save a snapshot when a quotation goes out, then re-price and
 *     compare: line-by-line rate/amount movement, per-group swing and the
 *     headline delta. "What happened when we changed the numbers", answered.
 *
 * IMPORTANT (learned the hard way — see the nested-component focus bug
 * memory): every editable row component is defined at MODULE level, not
 * inside the workspace component. Nested definitions remount on each render
 * and inputs lose focus after one keystroke.
 *
 * Styling: same pinned light palette + card language as the P&L page and
 * Finance Analysis. The maths lives in tender-model.ts, shared with the
 * printed quotation so the two can never disagree.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { saveTenderAnalysesAction } from "./tender-actions";
import {
  GROUP_COLORS, TENDER_UOMS, blankQuote, computeSection, computeSheetTotal, diffSheets, itemRupees, itemPerUnit, sectionsOf, uomShort,
  type SheetCalc, type SheetDiff, type TenderAnalysis, type TenderGroup, type TenderItem, type TenderItemMode, type TenderQuote, type TenderSection, type TenderUom, type TenderVersion,
} from "./tender-model";

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

/** Exact rupees — the diff table needs the real number, not a Cr/L rounding. */
const inrExact = (v: number) => `${v < 0 ? "−" : ""}₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Fresh sheets. Their exact group list; the rate-card variant lands
 *  pre-filled from the live P&L window. `pace` is the window's REAL
 *  cutting pace (CFT/day) — the timeline's data-driven default. */
export type RateSeed = { stone: number; cutting: number; carving: number; label: string; pace: number | null };

const STARTER_GROUPS = ["Raw Material", "Cutting", "Carving", "Transportation", "Installation", "Other Expenses"];

function blankSheet(): TenderAnalysis {
  const now = new Date().toISOString();
  const section: TenderSection = {
    id: uid(), title: "", uom: "Cft.", qty: null,
    groups: STARTER_GROUPS.map((title) => ({ id: uid(), title, items: [{ id: uid(), title: "", mode: "per_cft" as TenderItemMode, value: 0 }] })),
  };
  return {
    id: uid(), name: "New project",
    paceCftPerDay: null, manualDays: null,
    createdAt: now, updatedAt: now,
    sections: [section],
    // Legacy mirror of section 1 — kept in step by every write path.
    qty: section.qty, uom: section.uom, groups: section.groups,
  };
}

/** A fresh master group carrying the full quotation skeleton — the button the
 *  office presses when the same scope repeats for another material. */
function templateSection(title: string, uom: TenderUom, seed: RateSeed | null): TenderSection {
  const rate = seed ? { stone: Math.round(seed.stone), cutting: Math.round(seed.cutting), carving: Math.round(seed.carving) } : null;
  return {
    id: uid(), title, uom, qty: seed ? 1000 : null,
    groups: QUOTE_TEMPLATE.map((g) => ({
      id: uid(),
      title: g.group,
      items: g.items.map((it) => ({
        id: uid(),
        title: it.seed && seed ? `${it.title} (rate card · ${seed.label})` : it.title,
        mode: it.mode ?? "per_cft",
        value: it.seed && rate ? rate[it.seed] : it.value ?? 0,
      })),
    })),
  };
}

/** The company's own quotation skeleton — every particular from the paper
 *  "Rate Breakup" sheet, grouped the way the office already thinks about
 *  them. Rate-card lines get a real number; the rest land at 0, titled and
 *  ready, so pricing a tender is filling boxes, not typing a sheet. */
const QUOTE_TEMPLATE: Array<{ group: string; items: Array<{ title: string; seed?: "stone" | "cutting" | "carving"; mode?: TenderItemMode; value?: number }> }> = [
  { group: "Raw material", items: [{ title: "Cut size material", seed: "stone" }] },
  { group: "Cutting", items: [{ title: "Cutting work", seed: "cutting" }] },
  { group: "Carving work", items: [{ title: "Carving work", seed: "carving" }] },
  { group: "Scaffolding & crane", items: [{ title: "Scaffolding equipment" }, { title: "Crane equipments" }] },
  { group: "Handling & transportation", items: [{ title: "Packaging" }, { title: "Loading & unloading" }, { title: "Transportation" }] },
  { group: "Installation & finishing", items: [{ title: "Installation" }, { title: "Final finishing" }] },
  { group: "Joining materials", items: [{ title: "Brick & sand work" }, { title: "White & gray cement" }, { title: "Metal clamps & pin" }, { title: "Sealer & adhesive material" }] },
  { group: "Site establishment", items: [{ title: "Accommodation" }] },
  { group: "Overheads & margin", items: [{ title: "Overheads", mode: "percent", value: 5 }, { title: "Profit margin", mode: "percent", value: 15 }] },
];

function seededSheet(seed: RateSeed): TenderAnalysis {
  const now = new Date().toISOString();
  const section = templateSection("Sandstone Carving Work", "Cft.", seed);
  return {
    id: uid(),
    name: "New project (from rate card)",
    paceCftPerDay: null, manualDays: null,
    createdAt: now, updatedAt: now,
    quote: { ...blankQuote(), terms: "Applicable as per resubmitted quotation sheet." },
    sections: [section],
    qty: section.qty, uom: section.uom, groups: section.groups,
  };
}

/** The sheet's timeline. Manual days win; otherwise quantity ÷ pace, where
 *  pace = the sheet's override or the live data pace. The quantity is the
 *  Cft. work across every master group (pace is a cutting rate, so Sqft. slab
 *  sections don't belong in it); with no Cft. section at all, the first
 *  section's quantity stands in. */
function timelineQty(secs: TenderSection[]): number | null {
  const cft = secs.filter((s) => s.uom === "Cft.").reduce((acc, s) => acc + (s.qty ?? 0), 0);
  if (cft > 0) return cft;
  return secs[0]?.qty ?? null;
}

function computeTimeline(a: TenderAnalysis, secs: TenderSection[], dataPace: number | null) {
  const pace = a.paceCftPerDay ?? dataPace;
  const qty = timelineQty(secs);
  const derived = qty && pace && pace > 0 ? qty / pace : null;
  const days = a.manualDays ?? derived;
  return {
    days,
    pace,
    qty,
    source: (a.manualDays != null ? "manual" : a.paceCftPerDay != null ? "custom pace" : "data pace") as "manual" | "custom pace" | "data pace",
    finish: days != null ? new Date(Date.now() + days * 86400000) : null,
  };
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

/** One worksheet row. `perUnit` is the rate this line contributes to the
 *  printed quotation — shown so the sheet reads like the document it becomes. */
function ItemRow({
  item, qty, base, unit, autoFocusTitle,
  onChange, onDelete, onEnter,
}: {
  item: TenderItem;
  qty: number | null;
  base: number;
  unit: string;
  autoFocusTitle: boolean;
  onChange: (patch: Partial<TenderItem>) => void;
  onDelete: () => void;
  onEnter: () => void;
}) {
  const rupees = itemRupees(item, qty, base);
  const perUnit = itemPerUnit(item, qty, base);
  return (
    <div className="tn-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 100px 70px 84px 24px", alignItems: "center", gap: 8, padding: "2px 6px", borderRadius: 10 }}>
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
        style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 5px", background: C.wash, outline: "none", cursor: "pointer" }}
      >
        <option value="amount">₹ fixed</option>
        <option value="per_cft">₹ / {unit}</option>
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
      {/* The quotation rate this line prints as — a lump sum spread over the
          quantity reads here exactly as the client will see it. */}
      <div title={`Rate per ${unit} on the quotation`} style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: perUnit != null && perUnit > 0 ? C.indigo : "#c8cdd6", fontVariantNumeric: "tabular-nums" }}>
        {perUnit != null && perUnit > 0 ? `${Math.round(perUnit).toLocaleString("en-IN")}/-` : "—"}
      </div>
      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: rupees > 0 ? C.ink2 : C.muted, fontVariantNumeric: "tabular-nums" }}>
        {rupees > 0 ? inr(rupees) : "—"}
        {item.mode === "per_cft" && qty == null && (
          <span title={`Set the project ${unit} above for ₹/${unit} lines to count.`} style={{ marginLeft: 4, color: C.amber }}>⚠</span>
        )}
      </div>
      <button type="button" className="tn-del" onClick={onDelete} title="Remove line"
        style={{ border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14, borderRadius: 8, padding: "4px 5px", justifySelf: "center" }}>
        ✕
      </button>
    </div>
  );
}

function GroupCard({
  group, index, sr, qty, base, grand, unit, focusItemId,
  onTitle, onItemChange, onItemDelete, onAddItem, onDelete,
}: {
  group: TenderGroup;
  index: number;
  /** "3" on a single-section sheet, "2.3" when master groups are in play —
   *  so a line can be pointed at across the sheet, the split and the print. */
  sr: string;
  qty: number | null;
  base: number;
  grand: number;
  unit: string;
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
        <span title={`Group ${sr}`} style={{ minWidth: 22, height: 20, padding: "0 6px", borderRadius: 6, background: color, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{sr}</span>
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 100px 70px 84px 24px", gap: 8, padding: "6px 14px 4px", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.11em", color: "#b6bdc9" }}>
        <span>ITEM</span><span>BASIS</span><span style={{ textAlign: "right" }}>VALUE</span><span style={{ textAlign: "right" }}>RATE/{unit.toUpperCase()}</span><span style={{ textAlign: "right" }}>AMOUNT</span><span />
      </div>
      <div style={{ padding: "0 8px 7px", display: "flex", flexDirection: "column", gap: 1 }}>
        {group.items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            qty={qty}
            base={base}
            unit={unit}
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

/** One cell of the command strip. */
function DarkStat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div title={hint} style={hint ? { cursor: "help", minWidth: 0 } : { minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", marginTop: 3, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

/** Letter fields for the printed quotation. Module level, focus-safe. */
function QuoteFields({ quote, onChange }: { quote: TenderQuote; onChange: (patch: Partial<TenderQuote>) => void }) {
  const f = (label: string, key: keyof TenderQuote, placeholder: string, wide = false, area = false) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <span style={{ ...eyebrow, fontSize: 9.5 }}>{label}</span>
      {area ? (
        <textarea
          className="tn-cell"
          rows={key === "terms" ? 3 : 2}
          value={quote[key]}
          placeholder={placeholder}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<TenderQuote>)}
          style={{ ...cellInput, border: `1px solid ${C.line}`, background: C.paper, fontWeight: 500, fontSize: 12.5, lineHeight: 1.6, resize: "vertical" }}
        />
      ) : (
        <input
          className="tn-cell"
          value={quote[key]}
          placeholder={placeholder}
          type={key === "date" ? "date" : "text"}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<TenderQuote>)}
          style={{ ...cellInput, border: `1px solid ${C.line}`, background: C.paper, fontSize: 12.5 }}
        />
      )}
    </label>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 11 }}>
      {f("To (name)", "toName", "Mr. Shubham Patil")}
      {f("Organisation", "toOrg", "Shree Ram Mandir, AVP'S SRIMS")}
      {f("Place", "toPlace", "Aurangabad (MH)")}
      {f("Work (table caption)", "work", "Sandstone Carving Work")}
      {f("Letter date", "date", "")}
      {f("Our ref (optional)", "refNo", "MTCPL/QTN/…")}
      {f("Opening paragraph", "intro", "We are resubmitting to you rate breakup analysis for construction of …", true, true)}
      {f("Terms & conditions — one per line", "terms", "Applicable as per resubmitted quotation sheet.", true, true)}
    </div>
  );
}

/** Version-vs-now diff table. */
function DiffPanel({ diff, unit, versionLabel, onClose }: { diff: SheetDiff; unit?: string | null; versionLabel: string; onClose: () => void }) {
  const up = diff.delta > 0;
  const tone = Math.abs(diff.delta) < 1 ? C.muted : up ? C.red : C.green;
  const th: React.CSSProperties = { ...eyebrow, fontSize: 9, padding: "0 8px 7px", textAlign: "right" };
  const td: React.CSSProperties = { padding: "6px 8px", fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right", borderTop: `1px solid ${C.line}` };
  const STATUS: Record<string, { t: string; c: string; bg: string }> = {
    added: { t: "NEW", c: C.green, bg: C.greenSoft },
    removed: { t: "REMOVED", c: C.red, bg: C.redSoft },
    changed: { t: "CHANGED", c: C.amber, bg: "rgba(194,116,10,0.1)" },
    same: { t: "—", c: "#c8cdd6", bg: "transparent" },
  };
  return (
    <div style={{ ...card, padding: "18px 20px 20px", borderColor: C.indigo, boxShadow: `0 0 0 1px ${C.indigo}, 0 14px 40px rgba(79,70,229,0.14)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ ...eyebrow, color: C.indigo }}>Compare · {versionLabel} → now</span>
        <button type="button" onClick={onClose} style={{ marginLeft: "auto", border: `1px solid ${C.line}`, background: C.paper, color: C.ink2, fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "5px 13px", cursor: "pointer" }}>
          ✕ Close compare
        </button>
      </div>

      {/* Headline movement */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          { k: "Then", v: inr(diff.oldGrand), s: diff.oldPerCft != null && unit ? `₹${Math.round(diff.oldPerCft).toLocaleString("en-IN")}/${unit}` : diff.sectionsChanged ? "master groups changed" : "no unit rate" },
          { k: "Now", v: inr(diff.newGrand), s: diff.newPerCft != null && unit ? `₹${Math.round(diff.newPerCft).toLocaleString("en-IN")}/${unit}` : diff.sectionsChanged ? "master groups changed" : "no unit rate" },
          { k: "Change", v: `${up ? "+" : ""}${inr(diff.delta)}`, s: diff.deltaPct != null ? `${up ? "+" : ""}${diff.deltaPct.toFixed(1)}%` : "—", tone },
          { k: "Lines moved", v: String(diff.changedCount), s: `of ${diff.lines.length}` },
        ].map((s) => (
          <div key={s.k} style={{ border: `1px solid ${C.line}`, borderRadius: 13, padding: "11px 14px", background: C.wash }}>
            <div style={{ ...eyebrow, fontSize: 9.5 }}>{s.k}</div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 3, color: s.tone ?? C.ink, fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{s.s}</div>
          </div>
        ))}
      </div>

      {diff.oldQty !== diff.newQty && unit && (
        <div style={{ fontSize: 11.5, color: C.amber, background: "rgba(194,116,10,0.08)", border: "1px solid rgba(194,116,10,0.25)", borderRadius: 10, padding: "8px 12px", marginBottom: 14, lineHeight: 1.6 }}>
          ⚠ The project quantity changed too — {diff.oldQty?.toLocaleString("en-IN") ?? "—"} → {diff.newQty?.toLocaleString("en-IN") ?? "—"} {unit}.
          Every ₹/{unit} line therefore moves in ₹ even where its rate is untouched.
        </div>
      )}
      {diff.sectionsChanged && (
        <div style={{ fontSize: 11.5, color: C.amber, background: "rgba(194,116,10,0.08)", border: "1px solid rgba(194,116,10,0.25)", borderRadius: 10, padding: "8px 12px", marginBottom: 14, lineHeight: 1.6 }}>
          ⚠ The number of master groups changed between these two versions, so only the
          totals and the line movements compare — there is no single per-unit rate to put beside them.
        </div>
      )}

      {/* Group swing */}
      {diff.groups.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>Where it moved</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {diff.groups.slice(0, 8).map((g) => {
              const max = Math.max(...diff.groups.map((x) => Math.abs(x.delta)), 1);
              const w = (Math.abs(g.delta) / max) * 50;
              return (
                <div key={g.title} style={{ display: "grid", gridTemplateColumns: "minmax(0,150px) 1fr minmax(0,110px)", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
                  <div style={{ position: "relative", height: 8, background: C.wash, borderRadius: 999 }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.line }} />
                    <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 999, background: g.delta > 0 ? C.red : C.green, left: g.delta > 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} />
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Math.abs(g.delta) < 1 ? C.muted : g.delta > 0 ? C.red : C.green }}>
                    {g.delta > 0 ? "+" : ""}{inr(g.delta)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Line-by-line */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Line</th>
              <th style={{ ...th, textAlign: "left" }}>Status</th>
              <th style={th}>Rate then</th>
              <th style={th}>Rate now</th>
              <th style={th}>₹ then</th>
              <th style={th}>₹ now</th>
              <th style={th}>Change</th>
            </tr>
          </thead>
          <tbody>
            {diff.lines.map((l) => {
              const st = STATUS[l.status];
              return (
                <tr key={l.key} style={{ background: l.status === "same" ? "transparent" : `${st.bg}` }}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ fontWeight: 700, color: C.ink }}>{l.title}</span>
                    <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>{l.group}</span>
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", color: st.c }}>{st.t}</span>
                  </td>
                  <td style={{ ...td, color: C.muted }}>{l.oldRate != null ? `${Math.round(l.oldRate).toLocaleString("en-IN")}/-` : "—"}</td>
                  <td style={{ ...td, color: C.ink2, fontWeight: 700 }}>{l.newRate != null ? `${Math.round(l.newRate).toLocaleString("en-IN")}/-` : "—"}</td>
                  <td style={{ ...td, color: C.muted }}>{l.oldAmount > 0 ? inrExact(l.oldAmount) : "—"}</td>
                  <td style={{ ...td, color: C.ink2, fontWeight: 700 }}>{l.newAmount > 0 ? inrExact(l.newAmount) : "—"}</td>
                  <td style={{ ...td, fontWeight: 800, color: Math.abs(l.delta) < 1 ? "#c8cdd6" : l.delta > 0 ? C.red : C.green }}>
                    {Math.abs(l.delta) < 1 ? "—" : `${l.delta > 0 ? "+" : ""}${inrExact(l.delta)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** THE split — donut + every group, numbered so a row can be pointed at.
 *  Deliberately the ONLY place the cost mix is drawn (it used to be in both
 *  the dark strip and a card under the sheet, saying the same thing twice). */
function SplitCard({ calc, multi }: { calc: SheetCalc; multi: boolean }) {
  const rows = calc.sections.flatMap((sec, si) =>
    sec.groups.filter((g) => g.total > 0).map((g, gi) => ({
      ...g,
      sr: multi ? `${si + 1}.${gi + 1}` : `${gi + 1}`,
      section: multi ? sec.title || `Section ${si + 1}` : "",
    })),
  );
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="tn-reveal" style={{ ...card, padding: "15px 20px 17px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={eyebrow}>Where the money goes</span>
        <span style={{ fontSize: 11, color: C.muted }}>{rows.length} priced group{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted }}>Add values to see the split.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
          <Donut groups={rows} grand={calc.grand} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "9px 22px", flex: 1, minWidth: 0 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 11, color: C.muted, marginBottom: 3 }}>
                  <span style={{ minWidth: 20, padding: "0 5px", borderRadius: 5, background: r.color, color: "#fff", fontSize: 9.5, fontWeight: 800, textAlign: "center", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{r.sr}</span>
                  <span style={{ fontWeight: 700, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                  <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", flexShrink: 0, fontWeight: 700, color: C.ink }}>{inr(r.total)}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0, width: 30, textAlign: "right" }}>
                    {calc.grand > 0 ? `${((r.total / calc.grand) * 100).toFixed(0)}%` : "—"}
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                  <div style={{ width: `${(r.total / max) * 100}%`, height: "100%", borderRadius: 999, background: r.color }} />
                </div>
                {r.section && <div style={{ fontSize: 9.5, color: "#b6bdc9", marginTop: 2.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{r.section}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── the workspace ─────────────────────────────────────────────────

export function TenderClient({ initial, seed }: { initial: TenderAnalysis[]; seed: RateSeed }) {
  const [sheets, setSheets] = useState<TenderAnalysis[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [railOpen, setRailOpen] = useState(true);
  const [wide, setWide] = useState(false);
  const [showLetter, setShowLetter] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);

  // "Full width" means full width: it hides the app menu AND the breakdown
  // rail, so the sheet owns the window. Coming back out restores both.
  const goWide = (next: boolean) => {
    setWide(next);
    setRailOpen(!next);
  };
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("vendor-cockpit-fullscreen", wide);
    return () => document.body.classList.remove("vendor-cockpit-fullscreen");
  }, [wide]);

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
  const sections = useMemo(() => (active ? sectionsOf(active) : []), [active]);
  const multiSection = sections.length > 1;
  const calc = useMemo(() => (active ? computeSheetTotal(active) : null), [active]);
  const timeline = useMemo(() => (active ? computeTimeline(active, sections, seed.pace) : null), [active, sections, seed.pace]);

  const versions = active?.versions ?? [];
  const compareVersion = versions.find((v) => v.id === compareId) ?? null;
  const diff = useMemo(
    () => (active && compareVersion ? diffSheets(compareVersion, active) : null),
    [active, compareVersion],
  );

  const patchActive = (fn: (a: TenderAnalysis) => TenderAnalysis) =>
    mutate((prev) => prev.map((s) => (s.id === activeId ? fn(s) : s)));

  /** THE write path for anything inside the sheet. Lifts a legacy sheet into
   *  sections on first touch, and keeps the legacy top-level mirror of
   *  section 1 in step with what the server writes. */
  const patchSections = (fn: (secs: TenderSection[]) => TenderSection[]) =>
    patchActive((a) => {
      const next = fn(sectionsOf(a).map((s) => ({ ...s, id: s.id || uid() })));
      const first = next[0];
      return { ...a, sections: next, qty: first?.qty ?? null, uom: first?.uom, groups: first?.groups ?? [] };
    });

  const patchSection = (sectionId: string, fn: (s: TenderSection) => TenderSection) =>
    patchSections((secs) => secs.map((s) => (s.id === sectionId ? fn(s) : s)));

  const addSheet = (fromRateCard: boolean) => {
    const a = fromRateCard ? seededSheet(seed) : blankSheet();
    mutate((prev) => [a, ...prev]);
    setActiveId(a.id);
    setCompareId(null);
  };

  const addItem = (sectionId: string, groupId: string) => {
    const it: TenderItem = { id: uid(), title: "", mode: "per_cft", value: 0 };
    setFocusItemId(it.id);
    patchSection(sectionId, (s) => ({ ...s, groups: s.groups.map((g) => (g.id === groupId ? { ...g, items: [...g.items, it] } : g)) }));
  };

  /** Freeze the sheet as it stands — the version the team actually sent. */
  const saveVersion = () => {
    if (!active) return;
    const suggested = `v${(active.versions?.length ?? 0) + 1}`;
    const label = window.prompt("Name this version — e.g. \"v1 — sent to Shubham\"", suggested);
    if (label == null) return;
    const snapSections = JSON.parse(JSON.stringify(sectionsOf(active))) as TenderSection[];
    const snap: TenderVersion = {
      id: uid(),
      label: label.trim() || suggested,
      savedAt: new Date().toISOString(),
      sections: snapSections,
      // Legacy mirror, so an older reader still sees a coherent snapshot.
      qty: snapSections[0]?.qty ?? null,
      groups: snapSections[0]?.groups ?? [],
      grand: computeSheetTotal({ sections: snapSections }).grand,
    };
    patchActive((a) => ({ ...a, versions: [snap, ...(a.versions ?? [])].slice(0, 12) }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: railOpen ? "250px minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
      {/* ── rail: sheet list ── */}
      {railOpen && (
        <div style={{ ...card, padding: "15px 13px", position: "sticky", top: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 10px" }}>
            <span style={eyebrow}>Your breakdowns</span>
            <button type="button" onClick={() => setRailOpen(false)} title="Collapse this list — more room for the sheet"
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2 }}>
              ⇤
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button type="button" onClick={() => addSheet(true)} style={railBtn(true)} title={`Every quotation particular pre-titled; stone / cutting / carving priced from the ${seed.label} rate card`}>
              ⚡ New from rate card
            </button>
            <button type="button" onClick={() => addSheet(false)} style={railBtn(false)}>＋ New blank sheet</button>
          </div>
          <div style={{ height: 1, background: C.line, margin: "13px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "52vh", overflowY: "auto" }}>
            {sheets.length === 0 && (
              <div style={{ fontSize: 12, color: C.muted, padding: "4px 6px", lineHeight: 1.6 }}>
                Nothing yet — start a sheet and price your first tender.
              </div>
            )}
            {sheets.map((sh) => {
              const c = computeSheetTotal(sh);
              const isActive = sh.id === activeId;
              return (
                <div
                  key={sh.id}
                  className="tn-sheet"
                  onClick={() => { setActiveId(sh.id); setCompareId(null); }}
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
                        copy.versions = [];
                        const secs = sectionsOf(copy).map((sec) => ({
                          ...sec, id: uid(),
                          groups: sec.groups.map((g) => ({ ...g, id: uid(), items: g.items.map((it) => ({ ...it, id: uid() })) })),
                        }));
                        copy.sections = secs;
                        copy.groups = secs[0]?.groups ?? [];
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
                    {inr(c.grand)}
                    {c.perCft != null && c.uom && <> · ₹{Math.round(c.perCft).toLocaleString("en-IN")}/{uomShort(c.uom)}</>}
                    {c.sections.length > 1 && <> · {c.sections.length} sections</>}
                    {(sh.versions?.length ?? 0) > 0 && <> · {sh.versions!.length}v</>}
                  </div>
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
          <div style={{ marginTop: 13, display: "flex", justifyContent: "flex-end" }}>
            <SavePill state={saveState} />
          </div>
        </div>
      )}

      {/* ── workspace ── */}
      {!active || !calc ? (
        <div className="tn-reveal" style={{ ...card, padding: "64px 30px 58px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div aria-hidden style={{ position: "absolute", top: -90, left: "50%", transform: "translateX(-50%)", width: 340, height: 280, background: `radial-gradient(ellipse, ${C.indigoSoft}, transparent 70%)` }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 40, filter: "drop-shadow(0 6px 14px rgba(79,70,229,0.25))" }}>🧮</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginTop: 10, letterSpacing: "-0.02em" }}>Price a tender like you mean it</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.7 }}>
              Master groups → cost groups → lines, a printable rate-breakup quotation and a version-to-version compare.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
              {[
                { n: "1", t: "Start from the rate card", d: "every quotation particular, pre-titled" },
                { n: "2", t: "Add a master group", d: "sandstone in Cft., marble in Sqft." },
                { n: "3", t: "Print the quotation", d: "one rate table per master group" },
                { n: "4", t: "Save a version", d: "re-price later and compare the swing" },
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
            {!railOpen && (
              <button type="button" onClick={() => setRailOpen(true)} style={{ ...railBtn(true), marginTop: 22, display: "inline-block" }}>⇥ Show my breakdowns</button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
          {/* Sheet header: name + timeline inputs + actions. Quantity and unit
              now live on each master group, where they belong. */}
          <div className="tn-reveal" style={{ ...card, padding: "14px 18px 15px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.indigo}, #0284c7, ${C.green}, ${C.amber})` }} />
            {!railOpen && (
              <button type="button" onClick={() => setRailOpen(true)} title="Show the breakdown list"
                style={{ border: `1px solid ${C.line}`, background: C.wash, color: C.ink2, borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", flexShrink: 0 }}>
                ⇥
              </button>
            )}
            <input
              className="tn-cell"
              style={{ ...cellInput, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", flex: "1 1 220px", minWidth: 170 }}
              value={active.name}
              placeholder="Project / tender name…"
              onChange={(e) => patchActive((a) => ({ ...a, name: e.target.value }))}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
              Pace
              <input
                className="tn-cell"
                type="number" min={0} step="any"
                placeholder={seed.pace != null ? String(Math.round(seed.pace)) : "—"}
                title={seed.pace != null ? `Blank = your real pace from the P&L window (${Math.round(seed.pace)} CFT/day)` : "No data pace for this window — enter your own"}
                value={active.paceCftPerDay ?? ""}
                onChange={(e) => patchActive((a) => ({ ...a, paceCftPerDay: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
                style={{ ...cellInput, width: 78, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
              />
              <span style={{ color: C.muted }}>CFT/day</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
              Time
              <input
                className="tn-cell"
                type="number" min={0} step="any"
                placeholder={timeline?.days != null && active.manualDays == null ? String(Math.ceil(timeline.days)) : "—"}
                title="Blank = calculated from the Cft. quantity ÷ pace. Type to fix the timeline manually."
                value={active.manualDays ?? ""}
                onChange={(e) => patchActive((a) => ({ ...a, manualDays: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
                style={{ ...cellInput, width: 74, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
              />
              <span style={{ color: C.muted }}>days</span>
            </label>

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: "auto", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setShowLetter((v) => !v)} style={ghostBtn(showLetter)}>✉️ Letter</button>
              <button type="button" onClick={saveVersion} style={ghostBtn(false)} title="Freeze today's numbers so a later re-price can be compared against them">📌 Save version</button>
              <a href={`/reports/tender/${active.id}/print`} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn(false), textDecoration: "none", display: "inline-block" }}>
                🖨 Quotation
              </a>
              <button type="button" onClick={() => goWide(!wide)} title={wide ? "Bring the app menu and the breakdown list back" : "Hide the app menu and the breakdown list — full-width sheet"} style={ghostBtn(wide)}>
                {wide ? "⇥ Exit full width" : "⛶ Full width"}
              </button>
              {!railOpen && <SavePill state={saveState} />}
            </div>
          </div>

          {/* Covering letter (collapsed by default — it's paperwork, not pricing) */}
          {showLetter && (
            <div className="tn-reveal" style={{ ...card, padding: "16px 18px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={eyebrow}>Quotation letter</span>
                <span style={{ fontSize: 11, color: C.muted }}>printed above the rate tables on MTCPL letterhead</span>
                <a href={`/reports/tender/${active.id}/print?amounts=1`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: C.indigo, textDecoration: "none" }}>
                  internal copy with ₹ amounts ↗
                </a>
              </div>
              <QuoteFields
                quote={active.quote ?? blankQuote()}
                onChange={(patch) => patchActive((a) => ({ ...a, quote: { ...(a.quote ?? blankQuote()), ...patch } }))}
              />
            </div>
          )}

          {/* ── COMMAND STRIP: the headline numbers, across the top. The cost
                split is NOT here — it lives once, in the card below. ── */}
          <div className="tn-dark tn-reveal" style={{ borderRadius: 18, padding: "16px 22px", position: "relative", overflow: "hidden", background: "linear-gradient(120deg, #0b1220 0%, #131c30 52%, #182441 100%)", boxShadow: "0 14px 36px rgba(11,18,32,0.30), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
            <div aria-hidden style={{ position: "absolute", top: -110, right: 60, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.32), transparent 65%)" }} />
            <div aria-hidden style={{ position: "absolute", bottom: -120, left: -40, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(2,132,199,0.20), transparent 65%)" }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
              <div style={{ minWidth: 200 }}>
                <div style={{ ...eyebrow, color: "rgba(255,255,255,0.55)" }}>Tender value</div>
                <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.035em", color: "#fff", fontVariantNumeric: "tabular-nums", marginTop: 5, lineHeight: 1 }}>
                  {inr(calc.grand)}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {calc.sections.map((sec, si) => (
                    sec.perCft == null ? null : (
                      <span key={sec.id} title={multiSection ? sec.title || `Section ${si + 1}` : undefined}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: "#c7d2fe", background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.35)", borderRadius: 999, padding: "3.5px 11px", fontVariantNumeric: "tabular-nums" }}>
                        {multiSection && <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>{si + 1}</span>}
                        ₹{Math.round(sec.perCft).toLocaleString("en-IN")}/{uomShort(sec.uom)}
                        <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>· {sec.qty?.toLocaleString("en-IN")}</span>
                      </span>
                    )
                  ))}
                </div>
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)" }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px 24px", flex: "1 1 460px", minWidth: 0 }}>
                <DarkStat label="₹ lines" value={inr(calc.base)} />
                <DarkStat label="% lines add" value={inr(calc.pctAdd)} hint="% lines are calculated on their own section's ₹ subtotal" />
                {multiSection && <DarkStat label="Master groups" value={String(calc.sections.length)} sub="each prints its own rate table" />}
                {timeline?.days != null ? (
                  <>
                    <DarkStat
                      label="⏱ Timeline"
                      value={`≈ ${Math.ceil(timeline.days).toLocaleString("en-IN")} days`}
                      sub={`${(timeline.days / 30.44).toFixed(1)} months · ${
                        timeline.source === "manual"
                          ? `manual${timeline.qty != null && timeline.days > 0 ? `, ${Math.round(timeline.qty / timeline.days).toLocaleString("en-IN")} CFT/day` : ""}`
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
                  <div style={{ gridColumn: "span 2", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                    ⏱ Set a <strong style={{ color: "rgba(255,255,255,0.85)" }}>quantity</strong> on a master group
                    {seed.pace != null && <> (real pace ~{Math.round(seed.pace)} CFT/day)</>} or type the days.
                  </div>
                )}
              </div>
            </div>
            {/* Month ruler */}
            {timeline?.days != null && timeline.days > 0 && timeline.days < 3700 && (
              <div style={{ position: "relative", display: "flex", gap: 3, marginTop: 13 }}>
                {Array.from({ length: Math.min(36, Math.max(1, Math.ceil(timeline.days / 30.44))) }, (_, i) => {
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

          {/* ── versions ── */}
          {versions.length > 0 && (
            <div className="tn-reveal" style={{ ...card, padding: "13px 18px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={eyebrow}>Versions</span>
              {versions.map((v) => {
                const on = v.id === compareId;
                const swing = calc.grand - v.grand;
                return (
                  <span key={v.id} className="tn-ver" style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${on ? C.indigo : C.line}`, background: on ? C.indigoSoft : C.paper, borderRadius: 999, padding: "5px 6px 5px 12px" }}>
                    <button type="button" onClick={() => setCompareId(on ? null : v.id)} title="Compare this version with the sheet as it stands now"
                      style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? C.indigo : C.ink }}>{v.label}</span>
                      <span style={{ fontSize: 10.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                        {inr(v.grand)}
                        {Math.abs(swing) >= 1 && (
                          <span style={{ marginLeft: 5, fontWeight: 800, color: swing > 0 ? C.red : C.green }}>
                            {swing > 0 ? "▲" : "▼"}{inr(Math.abs(swing))}
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="tn-del" title="Delete this version"
                      onClick={() => {
                        if (!window.confirm(`Delete version "${v.label}"?`)) return;
                        if (compareId === v.id) setCompareId(null);
                        patchActive((a) => ({ ...a, versions: (a.versions ?? []).filter((x) => x.id !== v.id) }));
                      }}
                      style={{ fontSize: 11, color: C.muted, cursor: "pointer", padding: "0 4px" }}>✕</span>
                  </span>
                );
              })}
              <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
                {compareId ? "comparing below" : "click a version to compare it with the numbers you have now"}
              </span>
            </div>
          )}

          {diff && compareVersion && (
            <div className="tn-reveal">
              <DiffPanel diff={diff} unit={calc.uom ? uomShort(calc.uom) : null} versionLabel={compareVersion.label} onClose={() => setCompareId(null)} />
            </div>
          )}

          {/* The split — once, above the sheet so it never needs scrolling to. */}
          <SplitCard calc={calc} multi={multiSection} />

          {/* ── master groups ── */}
          {sections.map((sec, si) => {
            const scalc = calc.sections[si];
            const unit = uomShort(sec.uom);
            return (
              <div key={sec.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Section bar — only shown once there is more than one master
                    group, or the user has named this one. A plain single-scope
                    sheet keeps its old, simpler face. */}
                {(multiSection || sec.title) && (
                  <div className="tn-reveal" style={{ ...card, padding: "11px 16px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderLeft: `4px solid ${C.indigo}` }}>
                    <span style={{ minWidth: 26, height: 26, borderRadius: 8, background: C.indigo, color: "#fff", fontSize: 12.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{si + 1}</span>
                    <input
                      className="tn-cell"
                      style={{ ...cellInput, fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.015em", flex: "1 1 200px", minWidth: 150 }}
                      value={sec.title}
                      placeholder="Master group — e.g. Sandstone Carving Work"
                      onChange={(e) => patchSection(sec.id, (x) => ({ ...x, title: e.target.value }))}
                    />
                    <SectionQty sec={sec} onPatch={(patch) => patchSection(sec.id, (x) => ({ ...x, ...patch }))} />
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(scalc.grand)}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                        {scalc.perCft != null ? `₹${Math.round(scalc.perCft).toLocaleString("en-IN")} per ${sec.uom}` : `set a quantity for the ${sec.uom} rate`}
                      </div>
                    </div>
                    <button type="button" className="tn-del" title="Remove this master group and everything in it"
                      onClick={() => {
                        if (!window.confirm(`Remove master group "${sec.title || si + 1}" and its ${sec.groups.length} group(s)?`)) return;
                        patchSections((secs) => (secs.length <= 1 ? secs : secs.filter((x) => x.id !== sec.id)));
                      }}
                      style={{ border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14, padding: "3px 5px" }}>✕</button>
                  </div>
                )}

                {/* This section's quantity, when it is the only section and has
                    no name — keeps the old single-scope header working. */}
                {!multiSection && !sec.title && (
                  <div className="tn-reveal" style={{ ...card, padding: "10px 16px 11px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={eyebrow}>Project quantity</span>
                    <SectionQty sec={sec} onPatch={(patch) => patchSection(sec.id, (x) => ({ ...x, ...patch }))} />
                    <button type="button" onClick={() => patchSection(sec.id, (x) => ({ ...x, title: "Sandstone Carving Work" }))}
                      style={{ ...ghostBtn(false), marginLeft: "auto" }} title="Name this scope so a second material can be added beside it">
                      ✎ Name this master group
                    </button>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(620px, 1fr))", gap: 11, alignItems: "start" }}>
                  {sec.groups.map((g, gi) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      index={calc.sections.slice(0, si).reduce((acc, x) => acc + x.groups.length, 0) + gi}
                      sr={multiSection ? `${si + 1}.${gi + 1}` : `${gi + 1}`}
                      qty={sec.qty}
                      base={scalc.base}
                      grand={scalc.grand}
                      unit={unit}
                      focusItemId={focusItemId}
                      onTitle={(t) => patchSection(sec.id, (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, title: t } : y)) }))}
                      onItemChange={(itemId, patch) =>
                        patchSection(sec.id, (x) => ({
                          ...x,
                          groups: x.groups.map((y) =>
                            y.id === g.id ? { ...y, items: y.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) } : y,
                          ),
                        }))
                      }
                      onItemDelete={(itemId) =>
                        patchSection(sec.id, (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, items: y.items.filter((it) => it.id !== itemId) } : y)) }))
                      }
                      onAddItem={() => addItem(sec.id, g.id)}
                      onDelete={() => {
                        const hasValues = g.items.some((it) => it.value > 0 || it.title.trim());
                        if (hasValues && !window.confirm(`Remove "${g.title || "this group"}" and its ${g.items.length} line(s)?`)) return;
                        patchSection(sec.id, (x) => ({ ...x, groups: x.groups.filter((y) => y.id !== g.id) }));
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => patchSection(sec.id, (x) => ({ ...x, groups: [...x.groups, { id: uid(), title: "", items: [{ id: uid(), title: "", mode: "per_cft", value: 0 }] }] }))}
                  style={{ alignSelf: "flex-start", fontSize: 12.5, fontWeight: 800, color: C.indigo, background: C.indigoSoft, border: `1px dashed ${C.indigo}55`, borderRadius: 12, padding: "9px 17px", cursor: "pointer" }}
                >
                  ＋ Add group{multiSection || sec.title ? ` to ${sec.title || `master group ${si + 1}`}` : ""}
                </button>
              </div>
            );
          })}

          {/* Add a second material / scope — the whole quotation skeleton again. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 4, borderTop: `1px dashed ${C.line}`, marginTop: 4 }}>
            <span style={{ fontSize: 11.5, color: C.muted, paddingTop: 12 }}>
              Same scope for another material? Add a master group — it gets its own quantity, unit and rate table on the quotation.
            </span>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("Name the master group — e.g. \"Marble Slab\"", "Marble Slab");
                if (name == null) return;
                patchSections((secs) => {
                  // Name the first one too, so the quotation's tables are both
                  // captioned rather than one falling back to the sheet name.
                  const named = secs.map((x, i) => (i === 0 && !x.title ? { ...x, title: "Sandstone Carving Work" } : x));
                  return [...named, templateSection(name.trim() || "New master group", "Sqft.", null)];
                });
              }}
              style={{ marginTop: 12, marginLeft: "auto", fontSize: 12.5, fontWeight: 800, color: "#fff", background: C.indigo, border: "none", borderRadius: 12, padding: "10px 18px", cursor: "pointer" }}
            >
              ＋ Add master group
            </button>
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
.tn-cell:focus { border-color: ${C.indigo} !important; background: #fff !important; box-shadow: 0 0 0 3px ${C.indigoSoft}; }
.tn-cell::placeholder { color: #b6bdc9; font-weight: 500; }
.tn-row .tn-del, .tn-sheet .tn-del, .tn-ver .tn-del { opacity: 0; transition: opacity .12s; }
.tn-row:hover .tn-del, .tn-sheet:hover .tn-del, .tn-ver:hover .tn-del { opacity: 1; }
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

/** Quantity + unit for one master group. Module level — focus-safe. */
function SectionQty({ sec, onPatch }: { sec: TenderSection; onPatch: (patch: Partial<TenderSection>) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: C.ink2, flexShrink: 0 }}>
      <input
        className="tn-cell"
        type="number" min={0} step="any" placeholder="—"
        value={sec.qty ?? ""}
        onChange={(e) => onPatch({ qty: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
        style={{ ...cellInput, width: 100, textAlign: "right", border: `1px solid ${C.line}`, background: C.paper, fontVariantNumeric: "tabular-nums" }}
      />
      <select
        value={sec.uom}
        onChange={(e) => onPatch({ uom: e.target.value as TenderUom })}
        title="Billing unit — rides through every rate and this group's Uom. column on the quotation"
        style={{ fontSize: 11.5, fontWeight: 800, color: C.ink2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 6px", background: C.wash, outline: "none", cursor: "pointer" }}
      >
        {TENDER_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </label>
  );
}

/** Live autosave status. Lives in the rail, or in the toolbar when the rail
 *  is collapsed — it must never disappear. */
function SavePill({ state }: { state: "idle" | "dirty" | "saving" | "saved" | "error" }) {
  const busy = state === "saving" || state === "dirty";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", borderRadius: 999, padding: "4px 11px", color: state === "error" ? C.red : busy ? C.amber : C.green, background: state === "error" ? C.redSoft : busy ? "rgba(194,116,10,0.1)" : C.greenSoft }}>
      <span className={busy ? "tn-pulse" : undefined} style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {state === "saving" ? "SAVING" : state === "dirty" ? "EDITING" : state === "error" ? "SAVE FAILED — EDIT TO RETRY" : "AUTOSAVED"}
    </span>
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

const ghostBtn = (on: boolean): React.CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 800,
  padding: "7px 12px",
  borderRadius: 999,
  cursor: "pointer",
  border: `1px solid ${on ? C.indigo : C.line}`,
  background: on ? C.indigoSoft : C.paper,
  color: on ? C.indigo : C.ink2,
  whiteSpace: "nowrap",
});
