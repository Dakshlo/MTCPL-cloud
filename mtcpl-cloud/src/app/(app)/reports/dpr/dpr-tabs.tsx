"use client";

/**
 * DPR section tabs — switches between Block Added / Block Cutted / Carving Done
 * INSTANTLY (no full-page reload). The first section is server-rendered for a
 * fast first paint; the others are fetched once via a server action and cached,
 * and prefetched in the background on mount so a click never waits on the
 * network. Re-clicking an already-loaded tab is instant.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DprSection } from "@/lib/dpr-section";
import { DprGrid } from "./dpr-grid";
import { loadDprSectionAction } from "./actions";

export type DprSectionKey = "block_added" | "block_cutted" | "carving_done" | "dispatched";

const SECTIONS: { key: DprSectionKey; label: string }[] = [
  { key: "block_added", label: "Block Added" },
  { key: "block_cutted", label: "Block Cutted" },
  { key: "carving_done", label: "Carving Done" },
  { key: "dispatched", label: "Dispatched" },
];

const VIEW: Record<DprSectionKey, { title: string; shortUnit: string; longUnit: string; note: string }> = {
  block_added: {
    title: "BLOCK ADDED",
    shortUnit: "blk",
    longUnit: "block",
    note: "CFT = L×W×H ÷ 1728 · stone-wise → vendor-wise (no-vendor blocks shown under “NO VENDOR”) · marble is tonnage-based so those cells show tonnes (T)",
  },
  block_cutted: {
    title: "BLOCK CUTTED",
    shortUnit: "slab",
    longUnit: "slab",
    note: "CFT = L×W×T ÷ 1728 · temple-wise → stone-wise · windowed by the slab’s cut-done date",
  },
  carving_done: {
    title: "CARVING DONE",
    shortUnit: "slab",
    longUnit: "slab",
    note: "CFT = L×W×T ÷ 1728 · temple-wise → CNC / outsource carving vendor · windowed by when carving finished (released to dispatch) · excludes direct-dispatch slabs that skipped carving",
  },
  dispatched: {
    title: "DISPATCHED",
    shortUnit: "slab",
    longUnit: "slab",
    note: "CFT = L×W×T ÷ 1728 · temple-wise → stone-wise · counted when the truck is released (owner-approved invoice → on the road); windowed by that date",
  },
};

/** Day-of-month (1–31) of an instant, in IST — the ÷N for the daily average. */
function istDayOfMonth(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return new Date(t + 5.5 * 3_600_000).getUTCDate();
}

export function DprTabs({ initialKey, initialReport }: { initialKey: DprSectionKey; initialReport: DprSection }) {
  const [active, setActive] = useState<DprSectionKey>(initialKey);
  const [cache, setCache] = useState<Partial<Record<DprSectionKey, DprSection>>>({ [initialKey]: initialReport });
  // Mirror cache + track in-flight in refs so the stable `ensure` never refetches.
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inflight = useRef<Set<DprSectionKey>>(new Set());

  const ensure = useCallback(async (key: DprSectionKey) => {
    if (cacheRef.current[key] || inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const report = await loadDprSectionAction(key);
      setCache((c) => ({ ...c, [key]: report }));
    } catch {
      /* leave uncached — a click will retry */
    } finally {
      inflight.current.delete(key);
    }
  }, []);

  // Background-prefetch every section once, so switches are instant.
  useEffect(() => {
    for (const s of SECTIONS) void ensure(s.key);
  }, [ensure]);

  function switchTo(key: DprSectionKey) {
    setActive(key);
    void ensure(key);
    try { window.history.replaceState(null, "", `/reports/dpr?section=${key}`); } catch { /* ignore */ }
  }

  const report = cache[active];
  const view = VIEW[active];

  // DAILY AVG column — trial on Block Cutted only (Daksh). Basis: this month's
  // total ÷ days elapsed this month (IST day-of-month of the generated time).
  const dailyAvg =
    active === "block_cutted" && report
      ? { label: "DAILY AVG", divisor: istDayOfMonth(report.generatedAt) }
      : undefined;

  return (
    <>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {SECTIONS.map((s) => {
          const on = active === s.key;
          const busy = !cache[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => switchTo(s.key)}
              style={{
                padding: "8px 16px", fontSize: 12.5, fontWeight: 800, borderRadius: 8,
                textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                background: on ? "var(--gold)" : "var(--bg)",
                color: on ? "#fff" : "var(--text)",
                border: `1px solid ${on ? "var(--gold-dark)" : "var(--border)"}`,
                whiteSpace: "nowrap",
              }}
            >
              {s.label}{!on && busy ? " …" : ""}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 2px 8px" }}>
        💡 Click any value cell to flip it to the {view.longUnit} count.
      </div>

      {report ? (
        <DprGrid report={report} title={view.title} shortUnit={view.shortUnit} longUnit={view.longUnit} dailyAvg={dailyAvg} />
      ) : (
        <div style={{ border: "1px solid #b6b6b6", borderRadius: 8, background: "#fff", padding: "28px 18px", fontSize: 13, color: "#777", textAlign: "center" }}>
          Loading {VIEW[active].title.toLowerCase()}…
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
        {report ? <>Generated {new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · </> : null}
        {view.note} · Daily = today, 7 Days = last 7 days, Month = this calendar month (IST).
        {dailyAvg ? ` · Daily avg = this month ÷ ${dailyAvg.divisor} day${dailyAvg.divisor === 1 ? "" : "s"} so far` : ""}
      </div>
    </>
  );
}
