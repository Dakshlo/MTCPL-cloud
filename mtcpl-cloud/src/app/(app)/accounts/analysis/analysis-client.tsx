"use client";

/**
 * Finance Analysis — client shell.
 *
 * Design brief (Daksh): "really good UI, crazy good and premium apple
 * feel." So: a light, calm, high-contrast surface; oversized display
 * numerals with tight tracking; generous whitespace; soft layered
 * shadows and 20px radii; colour used only where it carries meaning
 * (green = paid, amber = outstanding); and one smooth spring for the
 * vendor sheet. No library — everything below is hand-rolled CSS.
 *
 * Round 2 (Daksh, Aug 2026):
 *   • The three hero tiles are now BUTTONS — pressing one re-lenses
 *     the vendor list (order + which number leads on each row).
 *   • (An earlier "Peek for 20s" blur on Still outstanding was removed
 *     — the page is already owner+developer only, so hiding the figure
 *     from the only two people who can open it was pure friction.)
 *   • The vendor sheet is wider, locks the page behind it (it used to
 *     scroll-chain into the background), closes on Esc, and carries a
 *     much fuller stat block.
 *   • A vendor's bills read oldest → newest (sorted server-side).
 *
 * Read-only view: nothing here mutates anything.
 */

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  buildPlan,
  scoreBreakdown,
  MOOD_META,
  URGENCY_META,
  DEFAULT_TERMS_DAYS,
  type PayMetaMap,
  type PayMood,
  type PayUrgency,
  type VendorGroup,
  type PayPick,
} from "./recommend";
import { saveVendorPayMetaAction, saveVendorGroupsAction } from "./actions";

// ── Types shared with the server page ──────────────────────────────

export type VendorBill = {
  id: string;
  token: string | null;
  billNo: string | null;
  date: string | null;
  costHead: string | null;
  status: string;
  billed: number;
  paid: number;
  outstanding: number;
  /** Slice of `outstanding` the owner has deliberately withheld
   *  (mig 072). Clamped to outstanding server-side. The planner never
   *  suggests paying it. */
  held: number;
  heldReason: string | null;
};

export type VendorPayment = {
  id: string;
  date: string | null;
  amount: number;
  method: string | null;
  billToken: string | null;
};

export type VendorAnalysis = {
  id: string;
  name: string;
  /** The person behind the firm — several owners run more than one. */
  nickname: string | null;
  category: string | null;
  isActive: boolean;
  /** Credit period (days) from the vendor master; null = not recorded
   *  (the planner assumes DEFAULT_TERMS_DAYS and says so). */
  termsDays: number | null;
  billed: number;
  paid: number;
  outstanding: number;
  /** Total withheld across this vendor's open bills. */
  held: number;
  billCount: number;
  openBillCount: number;
  firstBillDate: string | null;
  lastPaymentDate: string | null;
  oldestOpenDate: string | null;
  bills: VendorBill[];
  payments: VendorPayment[];
};

export type MonthPoint = {
  key: string;
  label: string;
  year: number;
  paid: number;
  billed: number;
};

export type HeadSlice = { head: string; amount: number };

type Totals = { billed: number; paid: number; outstanding: number; bills: number };
type Metric = "billed" | "paid" | "outstanding";

// ── Formatting ─────────────────────────────────────────────────────

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** 1,23,45,678 → "1.23 Cr". Keeps hero numbers readable at a glance. */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}

/** Format n using the UNIT of `ref`, so a counting number doesn't flip
 *  from "52.5 L" to "1.23 Cr" mid-animation. */
function compactLike(n: number, ref: number): string {
  const a = Math.abs(ref);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}

/** Counts 0 → target ONCE on mount, then stops for good. rAF-driven and
 *  self-cancelling, so nothing is left running afterwards — the whole
 *  point of replacing the old always-on liquid bars. Honours
 *  prefers-reduced-motion by jumping straight to the value. */
function useCountUp(target: number, durationMs = 950, delayMs = 0): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setV(target);
      return;
    }
    let raf = 0;
    let startTs = 0;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / durationMs);
      setV(target * easeOut(p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, delayMs);
    // Guarantee the real figure even if rAF never runs. Browsers pause
    // requestAnimationFrame in a hidden/background tab, so without this
    // a page opened in a background tab would sit at ₹0 until focused —
    // and a finance screen showing zeros is far worse than one that
    // skips its animation. Caught in testing: with the preview pane
    // hidden, every sample read "0.00 Cr" and never moved.
    const settle = setTimeout(() => setV(target), delayMs + durationMs + 300);
    return () => {
      clearTimeout(timer);
      clearTimeout(settle);
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs, delayMs]);
  return v;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const p = iso.split("-").map(Number);
  if (p.length !== 3) return iso;
  return `${p[2]} ${MON[p[1] - 1]} ${p[0]}`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00+05:30`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ── Palette (light, pinned — finance is a light surface) ───────────

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
  amberSoft: "rgba(194,116,10,0.10)",
  indigo: "#4f46e5",
  indigoSoft: "rgba(79,70,229,0.10)",
  red: "#c0392b",
};

/** How many vendor rows render before the "Load all" footer. */
const VENDOR_PAGE = 10;

const METRIC_META: Record<Metric, { label: string; color: string; soft: string }> = {
  billed: { label: "Billed", color: C.indigo, soft: C.indigoSoft },
  paid: { label: "Paid", color: C.green, soft: C.greenSoft },
  outstanding: { label: "Open", color: C.amber, soft: C.amberSoft },
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

const display: React.CSSProperties = {
  fontWeight: 700,
  letterSpacing: "-0.035em",
  fontVariantNumeric: "tabular-nums",
  color: C.ink,
};

export function FinanceAnalysisClient({
  vendors,
  months,
  heads,
  aging,
  totals,
  activeVendorCount,
  payMeta,
  payGroups,
}: {
  vendors: VendorAnalysis[];
  months: MonthPoint[];
  heads: HeadSlice[];
  aging: Array<{ label: string; amount: number; count: number }>;
  totals: Totals;
  activeVendorCount: number;
  generatedFor?: string;
  payMeta: PayMetaMap;
  payGroups: VendorGroup[];
}) {
  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<Metric>("outstanding");
  const [alpha, setAlpha] = useState(false); // A–Z overrides the metric ordering
  const [openVendor, setOpenVendor] = useState<VendorAnalysis | null>(null);
  /** Vendor ids ticked for the cumulative comparison. Daksh: "he will
   *  select 5 vendors and see the data cumulative." */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Daksh: "every vendor section make it only load 10 vendors only.
   *  If wish to see all, under there will load all." 178 rows was a
   *  long scroll past the point anyone reads. */
  const [showAllVendors, setShowAllVendors] = useState(false);

  // ── Planner metadata — optimistic local copies of the two
  //    app_settings blobs; every edit fires the server action and
  //    reverts on failure. Finance data itself is never written.
  const [meta, setMeta] = useState<PayMetaMap>(payMeta);
  const [groups, setGroups] = useState<VendorGroup[]>(payGroups);
  const [, startSave] = useTransition();
  // Mirror of `meta` that updates synchronously. Two taps in the same
  // tick (e.g. 😠 then 🔥) otherwise both read the SAME stale closure
  // and the second wipes the first's optimistic value — caught live in
  // testing. Each save also sends the vendor's FULL meta, so whichever
  // server write lands last carries both fields.
  const metaRef = { current: meta } as { current: PayMetaMap };

  function setVendorMeta(vendorId: string, patch: { mood?: PayMood | null; urgency?: PayUrgency | null }) {
    const base = metaRef.current;
    const cur = { ...(base[vendorId] ?? {}) };
    if ("mood" in patch) {
      if (patch.mood == null) delete cur.mood;
      else cur.mood = patch.mood;
    }
    if ("urgency" in patch) {
      if (patch.urgency == null) delete cur.urgency;
      else cur.urgency = patch.urgency;
    }
    const next = { ...base };
    const full = Object.keys(cur).length === 0 ? null : cur;
    if (full == null) delete next[vendorId];
    else next[vendorId] = full;
    metaRef.current = next;
    setMeta(next);
    startSave(async () => {
      const res = await saveVendorPayMetaAction(vendorId, full);
      if (!res.ok) {
        metaRef.current = base;
        setMeta(base);
        alert(`Could not save: ${res.error}`);
      }
    });
  }

  function saveGroups(next: VendorGroup[]) {
    const prev = groups;
    setGroups(next);
    startSave(async () => {
      const res = await saveVendorGroupsAction(next);
      if (!res.ok) {
        setGroups(prev);
        alert(`Could not save groups: ${res.error}`);
      }
    });
  }

  /** Quick lookup: vendor id → the group it belongs to (if any). */
  const groupOf = useMemo(() => {
    const m = new Map<string, VendorGroup>();
    for (const g of groups) for (const id of g.vendorIds) m.set(id, g);
    return m;
  }, [groups]);

  /** Groups represented in the current tick-selection — so Ungroup can
   *  live right next to Group, instead of only as a ✕ on a chip down
   *  in the planner (Daksh couldn't find it there). */
  const pickedGroups = useMemo(() => {
    const out = new Map<string, VendorGroup>();
    for (const id of picked) {
      const g = groupOf.get(id);
      if (g) out.set(g.id, g);
    }
    return [...out.values()];
  }, [picked, groupOf]);

  function groupPicked() {
    const ids = [...picked];
    if (ids.length < 2) return;
    const members = vendors.filter((v) => picked.has(v.id));
    // Best default name: the person — the most common nickname among
    // what's ticked, else the first firm's name.
    const nick = members.map((v) => v.nickname).filter(Boolean)[0] ?? members[0]?.name ?? "Group";
    const name = window.prompt("Group these firms as one person. Name:", nick ?? "");
    if (!name || !name.trim()) return;
    // Ticking a vendor already in another group moves it here.
    const cleaned = groups
      .map((g) => ({ ...g, vendorIds: g.vendorIds.filter((id) => !picked.has(id)) }))
      .filter((g) => g.vendorIds.length >= 2);
    saveGroups([
      ...cleaned,
      { id: `g${Date.now().toString(36)}`, name: name.trim().slice(0, 80), vendorIds: ids },
    ]);
    setPicked(new Set());
  }

  // (Aug 2026 — the "Peek for 20s" blur on Still outstanding was
  // removed at Daksh's request. The page is already restricted to the
  // owner and the developer, so hiding the figure from the only two
  // people allowed to open it was friction with no benefit.)

  const collectedPct = totals.billed > 0 ? (totals.paid / totals.billed) * 100 : 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? vendors.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            // Daksh: "we have many people who have multiple firms, so
            // dad can search with nickname" — one query for "ketan"
            // now surfaces every firm that man runs.
            (v.nickname ?? "").toLowerCase().includes(q) ||
            (v.category ?? "").toLowerCase().includes(q) ||
            // …and searching a PERSON (group) name surfaces every firm
            // clubbed under him, even ones whose own name/nickname
            // doesn't contain the query.
            (groupOf.get(v.id)?.name.toLowerCase().includes(q) ?? false),
        )
      : vendors;
    const sorted = [...list];
    if (alpha) sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => b[metric] - a[metric]);
    return sorted;
  }, [vendors, query, metric, alpha, groupOf]);

  /** Groups whose name matches the search — offered as one-tap "select
   *  the whole person" chips above the list (Daksh: "if we choose that
   *  it will automatically select those group firms"). */
  const matchedGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  /** Total of the active metric across what's currently listed — this
   *  is the number that visibly changes as you press the hero tiles. */
  const shownTotal = useMemo(
    () => shown.reduce((s, v) => s + v[metric], 0),
    [shown, metric],
  );

  /** Cumulative figures for the ticked vendors — the "select 5 and see
   *  the combined position" view. Derived, never stored. */
  const pickedTotals = useMemo(() => {
    const chosen = vendors.filter((v) => picked.has(v.id));
    return chosen.reduce(
      (a, v) => ({
        n: a.n + 1,
        billed: a.billed + v.billed,
        paid: a.paid + v.paid,
        outstanding: a.outstanding + v.outstanding,
        bills: a.bills + v.billCount,
        openBills: a.openBills + v.openBillCount,
        names: a.names.concat(v.nickname || v.name),
      }),
      { n: 0, billed: 0, paid: 0, outstanding: 0, bills: 0, openBills: 0, names: [] as string[] },
    );
  }, [vendors, picked]);

  const maxMonth = Math.max(...months.map((m) => Math.max(m.paid, m.billed)), 1);
  const maxHead = Math.max(...heads.map((h) => h.amount), 1);
  const maxAging = Math.max(...aging.map((a) => a.amount), 1);

  function pick(m: Metric) {
    setMetric(m);
    setAlpha(false);
  }

  return (
    <section style={{ paddingBottom: 40 }}>
      <Styles />

      {/* ── Masthead ─────────────────────────────────────────── */}
      <header style={{ marginBottom: 26 }}>
        <div style={{ ...eyebrow, color: C.indigo }}>Owner view · Finance</div>
        <h1 style={{ ...display, margin: "6px 0 0", fontSize: 38, lineHeight: 1.05 }}>
          Finance Analysis
        </h1>
      </header>

      {/* ── Hero numbers (each one is a lens) ────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <HeroTile
          label="Total billed"
          amount={totals.billed}
          delay={0}
          foot={`${totals.bills.toLocaleString("en-IN")} bills · ${vendors.length} vendors`}
          accent={C.indigo}
          soft={C.indigoSoft}
          active={!alpha && metric === "billed"}
          onClick={() => pick("billed")}
        />
        <HeroTile
          label="Total paid"
          amount={totals.paid}
          delay={90}
          foot={`${collectedPct.toFixed(1)}% of everything billed`}
          accent={C.green}
          soft={C.greenSoft}
          active={!alpha && metric === "paid"}
          onClick={() => pick("paid")}
        />
        <HeroTile
          label="Still outstanding"
          amount={totals.outstanding}
          delay={180}
          foot={`across ${activeVendorCount} vendor${activeVendorCount === 1 ? "" : "s"}`}
          accent={C.amber}
          soft={C.amberSoft}
          active={!alpha && metric === "outstanding"}
          onClick={() => pick("outstanding")}
        />
      </div>

      {/* ── Settlement bar ───────────────────────────────────── */}
      <div className="fa-reveal" style={{ ...card, ["--d" as string]: "300ms", padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={eyebrow}>Settlement</div>
          <div style={{ fontSize: 13, color: C.muted }}>
            <strong style={{ color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(totals.paid)}</strong> paid
            {" · "}
            <strong style={{ color: C.amber, fontVariantNumeric: "tabular-nums" }}>{inr(totals.outstanding)}</strong> open
          </div>
        </div>
        <div
          style={{
            marginTop: 14,
            height: 14,
            borderRadius: 999,
            background: C.wash,
            overflow: "hidden",
            display: "flex",
            border: `1px solid ${C.line}`,
          }}
        >
          {/* Liquid fills (Daksh: "that settlement bar should be a
              moving liquid of different colour of paid and open").
              Each side is a wide multi-stop gradient that drifts
              sideways forever, with a soft sheen riding over it — so
              the two colours read as two liquids meeting, not two flat
              blocks. Pure CSS; no JS ticking. */}
          <div
            className="fa-grow"
            style={{ width: `${Math.min(collectedPct, 100)}%`, background: `linear-gradient(90deg, ${C.green}, #35c07a)` }}
            title={`Paid ${inr(totals.paid)}`}
          />
          <div style={{ flex: 1, background: `linear-gradient(90deg, ${C.amber}, #e0a44a)` }} title={`Outstanding ${inr(totals.outstanding)}`} />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
          {collectedPct.toFixed(1)}% of all billed value has been settled.
        </div>
      </div>

      {/* ── Cash out per month ───────────────────────────────── */}
      <div className="fa-reveal" style={{ ...card, ["--d" as string]: "420ms", padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={eyebrow}>Last 12 months</div>
            <div style={{ ...display, fontSize: 19, marginTop: 4 }}>Billed vs paid</div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <Legend color={C.indigo} label="Billed" />
            <Legend color={C.green} label="Paid" />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 22, overflowX: "auto" }}>
          {months.map((m) => (
            <div key={m.key} style={{ flex: 1, minWidth: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {m.paid > 0 ? compact(m.paid) : ""}
              </div>
              <div
                style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130, width: "100%", justifyContent: "center" }}
                title={`${m.label} ${m.year}\nBilled ${inr(m.billed)}\nPaid ${inr(m.paid)}`}
              >
                <Bar value={m.billed} max={maxMonth} color={C.indigo} />
                <Bar value={m.paid} max={maxMonth} color={C.green} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.ink2 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Aging + cost heads ───────────────────────────────── */}
      <div className="fa-reveal" style={{ ["--d" as string]: "540ms", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={{ ...card, padding: "20px 24px" }}>
          <div style={eyebrow}>How old is the open money</div>
          <div style={{ ...display, fontSize: 19, margin: "4px 0 18px" }}>Aging of outstanding</div>
          {aging.map((a) => (
            <div key={a.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.ink2, fontWeight: 600 }}>
                  {a.label} <span style={{ color: C.muted, fontWeight: 500 }}>· {a.count} bills</span>
                </span>
                <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(a.amount)}</strong>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                <div
                  className="fa-grow"
                  style={{ width: `${(a.amount / maxAging) * 100}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.amber}, #e8b45c)` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...card, padding: "20px 24px" }}>
          <div style={eyebrow}>Where the money goes</div>
          <div style={{ ...display, fontSize: 19, margin: "4px 0 18px" }}>By cost head</div>
          {heads.slice(0, 7).map((h) => (
            <div key={h.head} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, gap: 10 }}>
                <span style={{ color: C.ink2, fontWeight: 600, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.head.replace(/_/g, " ")}
                </span>
                <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{inr(h.amount)}</strong>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                <div
                  className="fa-grow"
                  style={{ width: `${(h.amount / maxHead) * 100}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.indigo}, #7c8cf8)` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Selected-vendors total ───────────────────────────────
          Appears only once something is ticked. Daksh: "he will select
          5 vendors and he will see the data cumulative." */}
      {pickedTotals.n > 0 && (
        <div
          style={{
            ...card,
            marginBottom: 14,
            padding: "16px 20px",
            border: `1px solid ${C.indigo}`,
            boxShadow: `0 0 0 1px ${C.indigo}22, 0 10px 28px ${C.indigoSoft}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...eyebrow, color: C.indigo }}>
                {pickedTotals.n} vendor{pickedTotals.n === 1 ? "" : "s"} selected · combined
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 560 }}>
                {pickedTotals.names.join(" · ")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {/* Undo, exactly where the grouping happened. Tick any
                  firm that's in a group and this appears — no hunting
                  for the ✕ on a chip further down the page. */}
              {pickedGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const ids = new Set(pickedGroups.map((g) => g.id));
                    saveGroups(groups.filter((g) => !ids.has(g.id)));
                  }}
                  title={`Split ${pickedGroups.map((g) => g.name).join(", ")} back into separate firms`}
                  style={{
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.ink2,
                    background: C.paper,
                    border: `1px solid ${C.indigo}66`,
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  ⇤ Ungroup {pickedGroups.map((g) => g.name).join(", ")}
                </button>
              )}
              {pickedTotals.n >= 2 && (
                <button
                  type="button"
                  onClick={groupPicked}
                  title="Club these firms as one person — the payment planner will treat any firm's payment as that person's"
                  style={{
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fff",
                    background: C.indigo,
                    border: `1px solid ${C.indigo}`,
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  🔗 Group as one person
                </button>
              )}
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.ink2,
                  background: C.wash,
                  border: `1px solid ${C.line}`,
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                Clear selection
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
            <MiniStat label="Billed" value={inr(pickedTotals.billed)} color={C.ink} />
            <MiniStat label="Paid" value={inr(pickedTotals.paid)} color={C.green} />
            <MiniStat label="Still open" value={pickedTotals.outstanding > 0.5 ? inr(pickedTotals.outstanding) : "Settled"} color={pickedTotals.outstanding > 0.5 ? C.amber : C.green} />
            <MiniStat
              label="Settled"
              value={`${pickedTotals.billed > 0 ? ((pickedTotals.paid / pickedTotals.billed) * 100).toFixed(1) : "0.0"}%`}
              color={C.ink2}
            />
            <MiniStat label="Bills open / total" value={`${pickedTotals.openBills} / ${pickedTotals.bills}`} color={C.ink2} />
          </div>

          <div style={{ marginTop: 14, height: 10, borderRadius: 999, background: C.wash, overflow: "hidden", border: `1px solid ${C.line}` }}>
            <div
              style={{
                width: `${pickedTotals.billed > 0 ? Math.min((pickedTotals.paid / pickedTotals.billed) * 100, 100) : 0}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${C.green}, #43c98a)`,
                transition: "width .3s cubic-bezier(.22,1,.36,1)",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Vendors ──────────────────────────────────────────── */}
      <div className="fa-reveal" style={{ ...card, ["--d" as string]: "660ms", overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${C.line}`,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={eyebrow}>
              Every vendor · by {alpha ? "name" : METRIC_META[metric].label.toLowerCase()}
            </div>
            <div style={{ ...display, fontSize: 19, marginTop: 4, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              {/* Say what's actually on screen, not what matched — a
                  "178 of 178" over 10 visible rows reads as a bug. */}
              <span>
                {showAllVendors || shown.length <= VENDOR_PAGE
                  ? `${shown.length} of ${vendors.length}`
                  : `Top ${VENDOR_PAGE} of ${shown.length}`}
              </span>
              {!alpha && (
                <span style={{ fontSize: 14, fontWeight: 600, color: METRIC_META[metric].color, fontVariantNumeric: "tabular-nums" }}>
                  {inr(shownTotal)} {METRIC_META[metric].label.toLowerCase()}
                </span>
              )}
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // A new search starts from the top 10 again.
              setShowAllVendors(false);
            }}
            placeholder="Search vendor, person or category…"
            className="fa-input"
            style={{
              flex: "1 1 240px",
              maxWidth: 340,
              padding: "11px 16px",
              fontSize: 14,
              color: C.ink,
              background: C.wash,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              outline: "none",
            }}
          />
          <div style={{ display: "inline-flex", background: C.wash, border: `1px solid ${C.line}`, borderRadius: 12, padding: 4, gap: 3 }}>
            {([
              ["outstanding", "Open"],
              ["paid", "Paid"],
              ["billed", "Billed"],
            ] as const).map(([k, lbl]) => (
              <SegBtn key={k} active={!alpha && metric === k} label={lbl} onClick={() => pick(k)} />
            ))}
            <SegBtn active={alpha} label="A–Z" onClick={() => setAlpha(true)} />
          </div>
        </div>

        {/* Person match — searching a group name offers the whole
            person as one tap: ticks every firm he runs, which lights
            the combined card above. */}
        {matchedGroups.length > 0 && (
          <div
            style={{
              padding: "12px 24px",
              borderBottom: `1px solid ${C.line}`,
              background: "rgba(79,70,229,0.04)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ ...eyebrow, color: C.indigo }}>Person</span>
            {matchedGroups.map((g) => {
              const allPicked = g.vendorIds.every((id) => picked.has(id));
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      // Toggle the whole person: tap once to select all
                      // his firms, tap again to drop them.
                      if (allPicked) g.vendorIds.forEach((id) => next.delete(id));
                      else g.vendorIds.forEach((id) => next.add(id));
                      return next;
                    })
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: allPicked ? "#fff" : C.indigo,
                    background: allPicked ? C.indigo : C.paper,
                    border: `1px solid ${C.indigo}`,
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  🔗 {g.name}
                  <span style={{ fontWeight: 600, opacity: 0.8 }}>
                    {allPicked ? "· selected ✓" : `· select ${g.vendorIds.length} firms`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {shown.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
            No vendor matches “{query}”.
          </div>
        ) : (
          <div>
            {(showAllVendors ? shown : shown.slice(0, VENDOR_PAGE)).map((v) => {
              const pct = v.billed > 0 ? (v.paid / v.billed) * 100 : 0;
              const age = daysSince(v.oldestOpenDate);
              const isPicked = picked.has(v.id);
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenVendor(v)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenVendor(v);
                    }
                  }}
                  className="fa-row"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "grid",
                    gridTemplateColumns: "26px minmax(170px,2fr) repeat(3, minmax(96px,1fr)) minmax(140px,1.2fr)",
                    gap: 14,
                    alignItems: "center",
                    padding: "16px 24px",
                    background: isPicked ? "rgba(79,70,229,0.06)" : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${C.line}`,
                    cursor: "pointer",
                  }}
                >
                  {/* Tick to add this vendor to the cumulative total.
                      stopPropagation so ticking doesn't also open the
                      vendor sheet. */}
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(v.id)) next.delete(v.id);
                        else next.add(v.id);
                        return next;
                      });
                    }}
                    aria-label={`Include ${v.name} in the total`}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: C.indigo }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 650, color: C.ink, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                      {/* The person first — that is what dad searches by. */}
                      {v.nickname ? (
                        <span style={{ color: C.indigo, fontWeight: 600 }}>✦ {v.nickname} · </span>
                      ) : null}
                      {groupOf.has(v.id) && (
                        <span
                          title={`Grouped: any of ${groupOf.get(v.id)!.name}'s firms count as one payee in the planner`}
                          style={{ color: C.indigo, fontWeight: 700 }}
                        >
                          🔗 {groupOf.get(v.id)!.name} ·{" "}
                        </span>
                      )}
                      {meta[v.id]?.mood && `${MOOD_META[meta[v.id]!.mood!].emoji} `}
                      {meta[v.id]?.urgency && `${URGENCY_META[meta[v.id]!.urgency!].emoji} `}
                      {v.billCount} bill{v.billCount === 1 ? "" : "s"}
                      {v.category ? ` · ${v.category}` : ""}
                      {v.lastPaymentDate ? ` · last paid ${fmtDate(v.lastPaymentDate)}` : " · never paid"}
                    </div>
                  </div>
                  <Cell label="Billed" value={inr(v.billed)} tone={C.ink2} lead={!alpha && metric === "billed"} />
                  <Cell label="Paid" value={inr(v.paid)} tone={C.green} lead={!alpha && metric === "paid"} />
                  <Cell
                    label="Open"
                    value={v.outstanding > 0.5 ? inr(v.outstanding) : "settled"}
                    tone={v.outstanding > 0.5 ? C.amber : C.muted}
                    lead={!alpha && metric === "outstanding"}
                  />
                  <div>
                    <div style={{ height: 7, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: pct >= 99.5 ? C.green : `linear-gradient(90deg, ${C.green}, #7fd4a4)` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                      {pct.toFixed(0)}% settled
                      {age != null && v.outstanding > 0.5 ? ` · oldest ${age}d` : ""}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Load-all footer — only when there's more behind it. */}
            {!showAllVendors && shown.length > VENDOR_PAGE && (
              <button
                type="button"
                onClick={() => setShowAllVendors(true)}
                className="fa-loadall"
                style={{
                  width: "100%",
                  padding: "16px 24px",
                  border: "none",
                  borderTop: `1px solid ${C.line}`,
                  background: C.wash,
                  color: C.indigo,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Load all {shown.length} vendors
                <span style={{ color: C.muted, fontWeight: 600 }}>
                  {" "}· {shown.length - VENDOR_PAGE} more
                </span>
              </button>
            )}
            {showAllVendors && shown.length > VENDOR_PAGE && (
              <button
                type="button"
                onClick={() => setShowAllVendors(false)}
                className="fa-loadall"
                style={{
                  width: "100%",
                  padding: "14px 24px",
                  border: "none",
                  borderTop: `1px solid ${C.line}`,
                  background: C.wash,
                  color: C.muted,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Show top {VENDOR_PAGE} only
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Payment planner ──────────────────────────────────────
          Sits LAST (Daksh, Aug 2026: "put this section in bottom").
          It's the act-on-it tool, so it reads after the picture the
          rest of the page paints. */}
      <PayPlanner
        vendors={vendors}
        groups={groups}
        meta={meta}
        onDissolveGroup={(gid) => saveGroups(groups.filter((g) => g.id !== gid))}
        onOpenVendorId={(id) => {
          const v = vendors.find((x) => x.id === id);
          if (v) setOpenVendor(v);
        }}
      />

      {openVendor && (
        <VendorSheet
          vendor={openVendor}
          companyOutstanding={totals.outstanding}
          onClose={() => setOpenVendor(null)}
          meta={meta[openVendor.id] ?? {}}
          onMeta={(patch) => setVendorMeta(openVendor.id, patch)}
          groupName={groupOf.get(openVendor.id)?.name ?? null}
        />
      )}
    </section>
  );
}

// ── Vendor detail sheet ────────────────────────────────────────────

function VendorSheet({
  vendor: v,
  companyOutstanding,
  onClose,
  meta,
  onMeta,
  groupName,
}: {
  vendor: VendorAnalysis;
  companyOutstanding: number;
  onClose: () => void;
  meta: { mood?: PayMood; urgency?: PayUrgency };
  onMeta: (patch: { mood?: PayMood | null; urgency?: PayUrgency | null }) => void;
  groupName: string | null;
}) {
  const [tab, setTab] = useState<"bills" | "payments">("bills");
  const pct = v.billed > 0 ? (v.paid / v.billed) * 100 : 0;
  const age = daysSince(v.oldestOpenDate);
  const sinceLastPaid = daysSince(v.lastPaymentDate);

  // Lock the page behind the sheet. Without this the wheel scrolled
  // THROUGH to the background page once the sheet hit its end (Daksh:
  // "when i scroll the background page get scrolled"). Also wire Esc.
  //
  // NOTE: lock the <html> element, not <body>. This app already sets
  // body { overflow: hidden } and scrolls on the document element
  // (document.scrollingElement === <html>), so a body-only lock is a
  // no-op here — verified in the browser before writing this.
  // overscroll-behavior: contain on the sheet is the second line of
  // defence for any nested scroller.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const paidCount = v.payments.length;
  const avgBill = v.billCount > 0 ? v.billed / v.billCount : 0;
  const shareOfOpen = companyOutstanding > 0 ? (v.outstanding / companyOutstanding) * 100 : 0;
  const biggestBill = v.bills.reduce((m, b) => Math.max(m, b.billed), 0);
  const settledCount = v.billCount - v.openBillCount;

  return (
    <div className="fa-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${v.name} detail`}>
      <div className="fa-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "26px 30px 20px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, #fbfcfe, ${C.paper})` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={eyebrow}>Vendor</div>
              <h2 style={{ ...display, fontSize: 27, margin: "6px 0 0", lineHeight: 1.15 }}>{v.name}</h2>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 7 }}>
                {v.category ? `${v.category.replace(/_/g, " ")} · ` : ""}
                {v.billCount} bill{v.billCount === 1 ? "" : "s"} · first billed {fmtDate(v.firstBillDate)}
                {!v.isActive && " · inactive"}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="fa-close">✕</button>
          </div>

          {/* Headline four */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 22 }}>
            <MiniStat label="Billed" value={inr(v.billed)} color={C.ink} />
            <MiniStat label="Paid" value={inr(v.paid)} color={C.green} />
            <MiniStat label="Still open" value={v.outstanding > 0.5 ? inr(v.outstanding) : "Settled"} color={v.outstanding > 0.5 ? C.amber : C.green} />
            <MiniStat label="Last paid" value={fmtDate(v.lastPaymentDate)} color={C.ink2} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ height: 10, borderRadius: 999, background: C.wash, overflow: "hidden", border: `1px solid ${C.line}` }}>
              <div className="fa-grow" style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: `linear-gradient(90deg, ${C.green}, #43c98a)` }} />
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>
              {pct.toFixed(1)}% settled
              {v.openBillCount > 0 && ` · ${v.openBillCount} bill${v.openBillCount === 1 ? "" : "s"} still open`}
              {age != null && v.outstanding > 0.5 && ` · oldest open ${age} days`}
            </div>
          </div>

          {/* Deeper facts — the "more informative" ask. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px,1fr))", gap: 10, marginTop: 16 }}>
            <Fact label="Bills open / settled" value={`${v.openBillCount} / ${settledCount}`} />
            <Fact label="Payments made" value={paidCount === 0 ? "None" : `${paidCount}`} />
            <Fact label="Average bill" value={inr(avgBill)} />
            <Fact label="Largest bill" value={inr(biggestBill)} />
            <Fact
              label="Share of all open"
              value={v.outstanding > 0.5 ? `${shareOfOpen.toFixed(1)}%` : "—"}
              hint={v.outstanding > 0.5 ? "of the company's outstanding" : undefined}
            />
            <Fact
              label="Since last payment"
              value={sinceLastPaid == null ? "Never paid" : `${sinceLastPaid} days`}
            />
            {v.held > 0.5 && (
              <Fact
                label="✋ On hold"
                value={inr(v.held)}
                hint="withheld on purpose — the planner skips it"
              />
            )}
          </div>

          {/* ── Planner dials (Daksh) — dad's read on the vendor, fed
              straight into the payment planner's scoring. Tapping the
              active emoji again clears it back to unset. */}
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              background: C.wash,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              display: "flex",
              gap: 22,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <EmojiDial
              label="Relationship"
              options={(["good", "avg", "bad"] as PayMood[]).map((k) => ({
                key: k,
                emoji: MOOD_META[k].emoji,
                title: MOOD_META[k].label,
              }))}
              value={meta.mood ?? null}
              onPick={(k) => onMeta({ mood: meta.mood === k ? null : (k as PayMood) })}
            />
            <EmojiDial
              label="Wants money"
              options={(["chill", "normal", "high"] as PayUrgency[]).map((k) => ({
                key: k,
                emoji: URGENCY_META[k].emoji,
                title: URGENCY_META[k].label,
              }))}
              value={meta.urgency ?? null}
              onPick={(k) => onMeta({ urgency: meta.urgency === k ? null : (k as PayUrgency) })}
            />
            <div style={{ fontSize: 11.5, color: C.muted, marginLeft: "auto" }}>
              Credit period{" "}
              <strong style={{ color: C.ink2 }}>
                {v.termsDays != null ? `${v.termsDays}d` : `${DEFAULT_TERMS_DAYS}d (assumed)`}
              </strong>
              {groupName ? (
                <>
                  {" · "}
                  <span style={{ color: C.indigo, fontWeight: 700 }}>🔗 {groupName}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: "14px 30px 0", display: "flex", gap: 6, alignItems: "center" }}>
          {([["bills", `Bills (${v.bills.length})`], ["payments", `Payments (${v.payments.length})`]] as const).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                borderRadius: 11,
                cursor: tab === k ? "default" : "pointer",
                background: tab === k ? C.ink : "transparent",
                color: tab === k ? "#fff" : C.muted,
              }}
            >
              {lbl}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
            {tab === "bills" ? "Oldest first" : "Newest first"}
          </span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "16px 30px 30px" }}>
          {tab === "bills" ? (
            v.bills.length === 0 ? (
              <Empty text="No bills recorded for this vendor." />
            ) : (
              v.bills.map((b) => {
                const bAge = daysSince(b.date);
                return (
                  <div key={b.id} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>
                        {b.token || b.billNo || "—"}
                        {b.billNo && b.token && <span style={{ color: C.muted, fontWeight: 500 }}> · bill {b.billNo}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                        {fmtDate(b.date)}
                        {bAge != null && b.outstanding > 0.5 ? ` · ${bAge}d old` : ""}
                        {b.costHead ? ` · ${b.costHead.replace(/_/g, " ")}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 96 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(b.billed)}</div>
                      <div style={{ fontSize: 11, color: b.paid > 0 ? C.green : C.muted, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                        {inr(b.paid)} paid
                      </div>
                    </div>
                    <div style={{ minWidth: 108, textAlign: "right" }}>
                      {b.outstanding > 0.5 ? (
                        <>
                          <span style={{ display: "inline-block", padding: "4px 11px", borderRadius: 999, background: C.amberSoft, color: C.amber, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            {inr(b.outstanding)} open
                          </span>
                          {b.held > 0.5 && (
                            <div
                              title={b.heldReason ? `Hold reason: ${b.heldReason}` : "Held by owner"}
                              style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: C.red, fontVariantNumeric: "tabular-nums" }}
                            >
                              ✋ {inr(b.held)} held
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ display: "inline-block", padding: "4px 11px", borderRadius: 999, background: C.greenSoft, color: C.green, fontSize: 11.5, fontWeight: 700 }}>
                          Settled
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )
          ) : v.payments.length === 0 ? (
            <Empty text="No payment has been made to this vendor yet." />
          ) : (
            <div style={{ position: "relative", paddingLeft: 22 }}>
              <div style={{ position: "absolute", left: 5, top: 8, bottom: 8, width: 2, background: C.line, borderRadius: 2 }} />
              {v.payments.map((p) => (
                <div key={p.id} style={{ position: "relative", padding: "13px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ position: "absolute", left: -21, top: 20, width: 10, height: 10, borderRadius: "50%", background: C.green, boxShadow: `0 0 0 3px ${C.greenSoft}` }} />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>{fmtDate(p.date)}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                        {p.method ? p.method.replace(/_/g, " ") : "payment"}
                        {p.billToken ? ` · ${p.billToken}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {inr(p.amount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payment planner ────────────────────────────────────────────────

const BUDGET_CHIPS: Array<[label: string, value: number]> = [
  ["5 L", 5e5],
  ["10 L", 1e6],
  ["15 L", 1.5e6],
  ["25 L", 2.5e6],
  ["50 L", 5e6],
  ["1 Cr", 1e7],
];

function PayPlanner({
  vendors,
  groups,
  meta,
  onDissolveGroup,
  onOpenVendorId,
}: {
  vendors: VendorAnalysis[];
  groups: VendorGroup[];
  meta: PayMetaMap;
  onDissolveGroup: (groupId: string) => void;
  onOpenVendorId: (vendorId: string) => void;
}) {
  const [budgetText, setBudgetText] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);

  const budget = useMemo(() => {
    const n = Number(budgetText.replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [budgetText]);

  const plan = useMemo(
    () => buildPlan(vendors, groups, meta, budget),
    [vendors, groups, meta, budget],
  );

  const allocPct = budget > 0 ? Math.min(100, (plan.allocated / budget) * 100) : 0;

  return (
    <div className="fa-reveal" style={{ ...card, ["--d" as string]: "780ms", marginTop: 16, overflow: "hidden" }}>
      <div style={{ padding: "20px 24px 18px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...eyebrow, color: C.indigo }}>Payment planner · read-only</div>
            <div style={{ ...display, fontSize: 19, marginTop: 4 }}>Who should I pay today?</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={eyebrow}>Payable pool</div>
            <div style={{ ...display, fontSize: 21, marginTop: 4, color: C.amber }}>{inr(plan.totalEligible)}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>open &amp; past credit period</div>
            {plan.totalHeld > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginTop: 4 }}>
                ✋ {inr(plan.totalHeld)} on hold · excluded
              </div>
            )}
          </div>
        </div>

        {/* Budget controls */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BUDGET_CHIPS.map(([lbl, val]) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setBudgetText(String(val))}
                style={{
                  padding: "8px 14px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  borderRadius: 999,
                  cursor: "pointer",
                  border: `1px solid ${budget === val ? C.indigo : C.line}`,
                  background: budget === val ? C.indigo : C.wash,
                  color: budget === val ? "#fff" : C.ink2,
                }}
              >
                ₹{lbl}
              </button>
            ))}
          </div>
          <input
            value={budgetText === "" ? "" : Number(budgetText).toLocaleString("en-IN")}
            onChange={(e) => setBudgetText(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="Or type an amount…"
            className="fa-input"
            style={{
              flex: "1 1 170px",
              maxWidth: 230,
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              color: C.ink,
              background: C.wash,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              outline: "none",
            }}
          />
          {budget > 0 && (
            <button
              type="button"
              onClick={() => setBudgetText("")}
              style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, color: C.muted, background: "transparent", border: "none", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Allocation summary */}
        {budget > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
              <span>
                <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(plan.allocated)}</strong>{" "}
                across {plan.picks.length} payee{plan.picks.length === 1 ? "" : "s"}
              </span>
              {plan.leftover > 0 && (
                <span>
                  <strong style={{ color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(plan.leftover)}</strong> left in hand
                </span>
              )}
            </div>
            <div style={{ height: 10, borderRadius: 999, background: C.wash, border: `1px solid ${C.line}`, overflow: "hidden" }}>
              <div style={{ width: `${allocPct}%`, height: "100%", background: `linear-gradient(90deg, ${C.indigo}, #7c8cf8)`, transition: "width .3s cubic-bezier(.22,1,.36,1)" }} />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {budget <= 0 ? (
        <div style={{ padding: "28px 24px", textAlign: "center", color: C.muted, fontSize: 13.5 }}>
          Pick a budget above — the plan appears instantly, ranked with reasons.
        </div>
      ) : plan.picks.length === 0 ? (
        <div style={{ padding: "28px 24px", textAlign: "center", color: C.muted, fontSize: 13.5 }}>
          Nothing to suggest — either the budget is too small or every open bill is still inside its
          credit period.
        </div>
      ) : (
        <div style={{ padding: "6px 24px 8px" }}>
          {plan.picks.map((p, i) => (
            <PickCard key={p.unit.key} pick={p} rank={i + 1} onOpenVendorId={onOpenVendorId} />
          ))}
        </div>
      )}

      {/* Skipped + groups footer */}
      <div style={{ padding: "10px 24px 18px", borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
        {budget > 0 && plan.skipped.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowSkipped((s) => !s)}
              style={{ border: "none", background: "transparent", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}
            >
              {showSkipped ? "▾" : "▸"} {plan.skipped.length} vendor{plan.skipped.length === 1 ? "" : "s"} not
              suggested (inside credit period or on hold)
            </button>
            {showSkipped && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                {plan.skipped.map((s) => (
                  <div key={s.unit.key} style={{ fontSize: 12, color: C.muted }}>
                    <strong style={{ color: C.ink2 }}>{s.unit.name}</strong> — {s.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {groups.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...eyebrow }}>People</span>
            {groups.map((g) => (
              <span
                key={g.id}
                title={`${g.vendorIds.length} firms count as one payee`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 7px 5px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.indigo,
                  background: C.indigoSoft,
                  border: `1px solid ${C.indigo}44`,
                  borderRadius: 999,
                }}
              >
                🔗 {g.name} · {g.vendorIds.length}
                <button
                  type="button"
                  onClick={() => onDissolveGroup(g.id)}
                  title={`Ungroup ${g.name}`}
                  style={{ border: "none", background: "transparent", color: C.indigo, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px" }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PickCard({ pick: p, rank, onOpenVendorId }: { pick: PayPick; rank: number; onOpenVendorId: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const u = p.unit;
  const shownCoverage = open ? p.coverage : p.coverage.slice(0, 3);
  // The five earned-marks behind the score — sums exactly to it.
  const marks = scoreBreakdown(p.components, p.score);
  return (
    <div style={{ padding: "16px 0", borderBottom: `1px solid ${C.line}` }} className="fa-pick">
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Rank */}
        <div
          style={{
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            color: rank <= 3 ? "#fff" : C.ink2,
            background: rank <= 3 ? C.indigo : C.wash,
            border: `1px solid ${rank <= 3 ? C.indigo : C.line}`,
          }}
        >
          {rank}
        </div>

        {/* Who */}
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onOpenVendorId(u.vendorIds[0])}
            title="Open detail"
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
              {u.isGroup ? `🔗 ${u.name}` : u.name}
            </span>
          </button>
          {u.isGroup && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {u.memberNames.join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
            {p.reasons.map((r, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 9px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.ink2,
                  background: C.wash,
                  border: `1px solid ${C.line}`,
                  borderRadius: 999,
                }}
              >
                <span aria-hidden>{r.icon}</span> {r.text}
              </span>
            ))}
          </div>
        </div>

        {/* Marks — its own ring, its own colour, its own unit, so the
            79 can never be misread as ₹79 or mixed with the amounts. */}
        <ScoreBadge score={p.score} />

        {/* How much */}
        <div style={{ textAlign: "right", minWidth: 150 }}>
          <div style={{ ...display, fontSize: 21, color: p.clearsFully ? C.green : C.ink }}>{inr(p.amount)}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {p.clearsFully ? "clears all payable" : `of ${inr(u.eligible)} payable`}
          </div>
          <div style={{ marginTop: 7, height: 6, width: 150, marginLeft: "auto", borderRadius: 999, background: C.wash, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, (p.amount / Math.max(u.eligible, 1)) * 100)}%`,
                height: "100%",
                background: p.clearsFully ? C.green : `linear-gradient(90deg, ${C.indigo}, #7c8cf8)`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Why these marks — Daksh: "give marks out of 100 why you think
          that decision." One track per pick: five coloured segments on
          a 100-wide bar, then the arithmetic spelled out so the badge
          can be checked by hand (the parts sum exactly to the score). */}
      <div style={{ marginTop: 10, marginLeft: 44 }}>
        <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: C.wash, maxWidth: 560 }}>
          {marks.map(
            (m) =>
              m.earned > 0 && (
                <div
                  key={m.key}
                  title={`${m.label}: ${m.earned}/${m.max}`}
                  style={{ width: `${m.earned}%`, background: m.color }}
                />
              ),
          )}
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: C.muted, display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
          {marks.map((m) => (
            <span key={m.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color, display: "inline-block" }} />
              {m.icon} {m.label}{" "}
              <strong style={{ color: C.ink2, fontVariantNumeric: "tabular-nums" }}>
                {m.earned}/{m.max}
              </strong>
            </span>
          ))}
        </div>
      </div>

      {/* Which bills this covers — n full + possibly one partial */}
      <div style={{ marginTop: 10, marginLeft: 44, fontSize: 12, color: C.muted, display: "flex", flexDirection: "column", gap: 3 }}>
        {shownCoverage.map((cvg, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ color: C.ink2, fontWeight: 650 }}>{cvg.billLabel}</span>
            {u.isGroup && <span>({cvg.vendorName})</span>}
            <span>{fmtDate(cvg.date)}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: cvg.full ? C.green : C.amber, fontWeight: 700 }}>
              {cvg.full
                ? `${inr(cvg.pay)} — full`
                : cvg.held > 0 && cvg.pay >= cvg.open - cvg.held - 0.5
                  ? // Payable part fully covered; the bill stays open only
                    // because the rest is deliberately held.
                    `${inr(cvg.pay)} of ${inr(cvg.open)} — rest on hold`
                  : `${inr(cvg.pay)} of ${inr(cvg.open)} — partial`}
            </span>
            {cvg.held > 0 && (
              <span style={{ color: C.red, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                ✋ {inr(cvg.held)} held
              </span>
            )}
          </div>
        ))}
        {p.coverage.length > 3 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: C.indigo, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}
          >
            {open ? "Show fewer bills" : `+${p.coverage.length - 3} more bill${p.coverage.length - 3 === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}

/** The priority marks, drawn as an indigo ring with an explicit /100 —
 *  a different shape, colour and unit from every rupee figure on the
 *  card, so it can't be confused with an amount. */
function ScoreBadge({ score }: { score: number }) {
  const r = 19;
  const circ = 2 * Math.PI * r;
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}
      title="Priority marks out of 100 — how strongly the planner recommends paying this vendor today. Not an amount. The coloured bar below shows exactly where the marks come from."
    >
      <svg width={46} height={46} viewBox="0 0 46 46" aria-label={`Priority ${score} out of 100`}>
        <circle cx={23} cy={23} r={r} fill="none" stroke={C.indigoSoft} strokeWidth={4.5} />
        <circle
          cx={23}
          cy={23}
          r={r}
          fill="none"
          stroke={C.indigo}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * circ} ${circ}`}
          transform="rotate(-90 23 23)"
        />
        <text x={23} y={27.5} textAnchor="middle" fontSize={14} fontWeight={800} fill={C.indigo}>
          {score}
        </text>
      </svg>
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.indigo }}>
        marks /100
      </span>
    </div>
  );
}

/** Three-emoji segmented dial (Relationship / Wants money). */
function EmojiDial({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Array<{ key: string; emoji: string; title: string }>;
  value: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2 }}>{label}</span>
      <div style={{ display: "inline-flex", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: 3, gap: 2 }}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            title={o.title}
            aria-pressed={value === o.key}
            onClick={() => onPick(o.key)}
            style={{
              width: 34,
              height: 30,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: value === o.key ? C.indigoSoft : "transparent",
              boxShadow: value === o.key ? `inset 0 0 0 1.5px ${C.indigo}` : "none",
              filter: value && value !== o.key ? "grayscale(0.9) opacity(0.55)" : "none",
              transition: "background .12s ease, filter .12s ease",
            }}
          >
            {o.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Small pieces ───────────────────────────────────────────────────

function HeroTile({
  label, amount, foot, accent, soft, active, onClick, delay = 0,
}: {
  label: string; amount: number; foot: string; accent: string; soft: string;
  active?: boolean; onClick?: () => void;
  /** ms to wait before this tile reveals + starts counting. */
  delay?: number;
}) {
  const counted = useCountUp(amount, 950, delay);
  const value = compactLike(counted, amount);
  const exact = inr(counted);
  return (
    <div
      className={`fa-hero fa-reveal${active ? " is-active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        ...card,
        ["--d" as string]: `${delay}ms`,
        padding: "22px 24px",
        position: "relative",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        borderColor: active ? accent : C.line,
        boxShadow: active
          ? `0 0 0 1px ${accent}, 0 10px 28px ${soft}`
          : card.boxShadow,
      }}
    >
      <div aria-hidden style={{ position: "absolute", right: -40, top: -40, width: 140, height: 140, borderRadius: "50%", background: soft, pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: accent, boxShadow: `0 0 0 3px ${soft}` }} />
          <span style={eyebrow}>{label}</span>
          {active && (
            <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, color: accent, letterSpacing: "0.06em" }}>
              SORTING
            </span>
          )}
        </div>

        <div style={{ ...display, fontSize: 34, marginTop: 12, lineHeight: 1.05 }}>{value}</div>
        <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{exact}</div>

        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 9 }}>{foot}</div>
      </div>
    </div>
  );
}

function Cell({ label, value, tone, lead }: { label: string; value: string; tone: string; lead: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...eyebrow, fontSize: 9.5, color: lead ? tone : C.muted }}>{label}</div>
      <div
        style={{
          fontSize: lead ? 15 : 13,
          fontWeight: lead ? 750 : 600,
          color: lead ? tone : C.ink2,
          opacity: lead ? 1 : 0.75,
          fontVariantNumeric: "tabular-nums",
          transition: "font-size .14s ease",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SegBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        border: "none",
        borderRadius: 9,
        cursor: active ? "default" : "pointer",
        background: active ? C.paper : "transparent",
        color: active ? C.ink : C.muted,
        boxShadow: active ? "0 1px 3px rgba(11,18,32,0.12)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.wash, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ ...eyebrow, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 5, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: "9px 12px", border: `1px solid ${C.line}`, borderRadius: 12 }} title={hint}>
      <div style={{ fontSize: 9.5, ...eyebrow, letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink2, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="fa-bar"
      style={{
        width: 13,
        height: value > 0 ? `${Math.max(pct, 2)}%` : 0,
        background: color,
        borderRadius: "4px 4px 0 0",
      }}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 44, textAlign: "center", color: C.muted, fontSize: 13.5 }}>{text}</div>;
}

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.fa-row { transition: background .12s ease; }
.fa-row:hover { background: #f7f9fc; }
.fa-loadall { transition: background .12s ease, color .12s ease; }
.fa-loadall:hover { background: #eef1f7; }
.fa-row:last-child { border-bottom: none !important; }
.fa-input:focus { border-color: ${C.indigo} !important; box-shadow: 0 0 0 4px rgba(79,70,229,0.12); background: #fff !important; }
.fa-bar { transition: height .5s cubic-bezier(.22,1,.36,1); }
.fa-grow { animation: faGrow .6s cubic-bezier(.22,1,.36,1) both; }
@keyframes faGrow { from { transform: scaleX(0); transform-origin: left } to { transform: scaleX(1); transform-origin: left } }

/* ── One-time entrance, top → down ───────────────────────────────
   Daksh: the infinite liquid bars lagged — 178 vendor bars each
   running a gradient animation plus a sheen pseudo-element meant ~380
   elements repainting forever. Replaced with a single cascading
   reveal: each band fades and lifts in once, staggered down the page
   (KPIs → settlement → chart → aging/heads → vendors), and the KPI
   figures count up from zero. After ~1.4s NOTHING is animating, so the
   page is completely static while you actually use it. */
.fa-reveal {
  animation: faReveal .5s cubic-bezier(.22,1,.36,1) both;
  animation-delay: var(--d, 0ms);
}
@keyframes faReveal {
  from { opacity: 0; transform: translateY(14px) }
  to   { opacity: 1; transform: translateY(0) }
}

/* Anyone who asked the OS for less motion gets the calm version. */
@media (prefers-reduced-motion: reduce) {
  .fa-reveal, .fa-grow, .fa-bar { animation: none; }
}

.fa-hero { transition: transform .16s cubic-bezier(.22,1,.36,1), box-shadow .16s ease, border-color .16s ease; }
.fa-hero[role="button"]:hover { transform: translateY(-2px); }
.fa-hero[role="button"]:active { transform: translateY(0); }
.fa-hero:focus-visible { outline: 2px solid ${C.indigo}; outline-offset: 3px; }

.fa-scrim {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(11,18,32,0.34);
  backdrop-filter: saturate(160%) blur(6px);
  display: flex; justify-content: flex-end;
  animation: faFade .18s ease both;
  overscroll-behavior: contain;
}
@keyframes faFade { from { opacity: 0 } to { opacity: 1 } }
.fa-sheet {
  width: 980px; max-width: 96vw; height: 100%;
  background: ${C.paper};
  display: flex; flex-direction: column;
  box-shadow: -20px 0 60px rgba(11,18,32,0.22);
  animation: faSlide .34s cubic-bezier(.22,1,.36,1) both;
  overscroll-behavior: contain;
}
@keyframes faSlide { from { transform: translateX(26px); opacity: .4 } to { transform: translateX(0); opacity: 1 } }
.fa-close {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid ${C.line}; background: ${C.wash};
  border-radius: 50%; cursor: pointer; font-size: 15px; color: ${C.ink2};
  transition: background .12s ease, color .12s ease;
}
.fa-close:hover { background: ${C.ink}; color: #fff; border-color: ${C.ink}; }
`,
      }}
    />
  );
}
