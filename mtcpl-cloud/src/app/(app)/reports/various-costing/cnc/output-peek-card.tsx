"use client";

/**
 * Daksh (June 2026) — clickable Output KPI tile on the CNC cost report.
 * Tap the tile → a centred peek modal opens listing every carved slab
 * counted in the period (size code · vendor · stone · dimensions · SFT ·
 * CFT). Lets the owner audit "which 267 slabs make up this output?".
 *
 * Sort modes: CFT (desc), SFT (desc), or Vendor-wise (grouped by vendor
 * with per-vendor SFT/CFT subtotals). Pure presentation — the slab list
 * is computed server-side in buildCncVariousCostReport(). Closes on Esc
 * + outside click. No deps beyond React.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CncContributingSlab } from "@/lib/cnc-various-cost-report";

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

type SortMode = "cft" | "sft" | "vendor";

export function OutputPeekCard({
  combinedOutput,
  totalSft,
  totalCft,
  slabsCount,
  contributingSlabs,
  periodLabel,
}: {
  combinedOutput: number;
  totalSft: number;
  totalCft: number;
  slabsCount: number;
  contributingSlabs: CncContributingSlab[];
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sort, setSort] = useState<SortMode>("cft");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const flat = useMemo(() => {
    const arr = [...contributingSlabs];
    if (sort === "sft") arr.sort((a, b) => b.sft - a.sft || b.cft - a.cft);
    else arr.sort((a, b) => b.cft - a.cft || b.sft - a.sft);
    return arr;
  }, [contributingSlabs, sort]);

  const vendorGroups = useMemo(() => {
    const m = new Map<string, CncContributingSlab[]>();
    for (const s of contributingSlabs) {
      const k = s.vendorName || "—";
      const arr = m.get(k);
      if (arr) arr.push(s);
      else m.set(k, [s]);
    }
    const groups = [...m.entries()].map(([vendor, rows]) => {
      const sorted = [...rows].sort((a, b) => b.cft - a.cft);
      return {
        vendor,
        rows: sorted,
        sft: sorted.reduce((a, s) => a + s.sft, 0),
        cft: sorted.reduce((a, s) => a + s.cft, 0),
      };
    });
    groups.sort((a, b) => b.cft - a.cft);
    return groups;
  }, [contributingSlabs]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view every slab counted in this output"
        style={{
          position: "relative",
          padding: "16px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
          transition: "transform 0.12s, box-shadow 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#10b981" }} />
        <div
          style={{
            fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase",
            letterSpacing: "0.07em", display: "flex", justifyContent: "space-between", alignItems: "center",
          }}
        >
          <span>Output</span>
          <span style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 700 }}>⌕ View slabs</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
          {fmtNum(combinedOutput)} units
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", opacity: 0.85, marginTop: 2 }}>
          SFT + CFT combined
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          {slabsCount} slab{slabsCount === 1 ? "" : "s"} counted
        </div>
      </button>

      {open && mounted &&
        createPortal(
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
              display: "grid", placeItems: "center", padding: "24px 16px", zIndex: 200, animation: "cncFade 0.15s",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff", borderRadius: 14, width: "94%", maxWidth: 920, maxHeight: "85vh",
                display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(15,23,42,0.25)",
                animation: "cncScaleIn 0.15s ease-out",
              }}
            >
              <div
                style={{
                  padding: "18px 22px", borderBottom: "1px solid #e2e8f0", display: "flex",
                  alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Output slabs · {periodLabel}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                    {slabsCount} slab{slabsCount === 1 ? "" : "s"} ·{" "}
                    <span style={{ fontFamily: "ui-monospace, monospace" }}>
                      {fmtNum(totalSft)} SFT / {fmtNum(totalCft)} CFT
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Carving approved within the selected window · double-side carving counts ×2
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Sort</span>
                  <div role="tablist" aria-label="Sort by" style={{ display: "inline-flex", background: "#f1f5f9", borderRadius: 999, padding: 3, gap: 2 }}>
                    <SortBtn active={sort === "cft"} onClick={() => setSort("cft")} label="CFT" />
                    <SortBtn active={sort === "sft"} onClick={() => setSort("sft")} label="SFT" />
                    <SortBtn active={sort === "vendor"} onClick={() => setSort("vendor")} label="Vendor-wise" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, background: "#f1f5f9", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" }}
                  >
                    Esc · Close
                  </button>
                </div>
              </div>

              <div style={{ overflow: "auto", padding: "8px 0" }}>
                {contributingSlabs.length === 0 ? (
                  <div style={{ padding: 48, textAlign: "center", color: "#64748b", fontSize: 14 }}>
                    No slabs were carved in this period.
                  </div>
                ) : sort === "vendor" ? (
                  <VendorGroupedTable groups={vendorGroups} totalSft={totalSft} totalCft={totalCft} slabsCount={slabsCount} />
                ) : (
                  <FlatTable slabs={flat} highlight={sort === "sft" ? "sft" : "cft"} totalSft={totalSft} totalCft={totalCft} />
                )}
              </div>
            </div>

            <style>{`
              @keyframes cncFade { from { opacity: 0 } to { opacity: 1 } }
              @keyframes cncScaleIn { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
            `}</style>
          </div>,
          document.body,
        )}
    </>
  );
}

function dims(s: CncContributingSlab): string {
  return `${fmtNum(s.lengthIn, 0)}× ${fmtNum(s.widthIn, 0)}× ${fmtNum(s.thicknessIn, 0)}`;
}

function FlatTable({
  slabs, highlight, totalSft, totalCft,
}: {
  slabs: CncContributingSlab[];
  highlight: "cft" | "sft";
  totalSft: number;
  totalCft: number;
}) {
  const hi = (col: "sft" | "cft"): React.CSSProperties =>
    col === highlight ? { background: "#fffbeb" } : {};
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
          <th style={th()}>Size Code</th>
          <th style={th()}>Vendor</th>
          <th style={th()}>Stone</th>
          <th style={{ ...th(), textAlign: "right" }}>Dimensions (in)</th>
          <th style={{ ...th(), textAlign: "right", ...hi("sft") }}>SFT</th>
          <th style={{ ...th(), textAlign: "right", ...hi("cft") }}>CFT</th>
        </tr>
      </thead>
      <tbody>
        {slabs.map((s, i) => (
          <tr key={`${s.id}-${i}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
            <td style={{ ...td(), fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
              {s.id}
              {s.sides === 2 && <span style={badge()}>2-side</span>}
            </td>
            <td style={td()}>{s.vendorName}</td>
            <td style={{ ...td(), color: "#64748b" }}>{s.stone ?? "—"}</td>
            <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{dims(s)}</td>
            <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: highlight === "sft" ? 700 : 400, ...hi("sft") }}>{fmtNum(s.sft)}</td>
            <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: highlight === "cft" ? 700 : 400, ...hi("cft") }}>{fmtNum(s.cft)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ background: "#fffbeb", borderTop: "2px solid #d97706" }}>
          <td style={{ ...td(), fontWeight: 800 }} colSpan={4}>Total</td>
          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{fmtNum(totalSft)}</td>
          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{fmtNum(totalCft)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function VendorGroupedTable({
  groups, totalSft, totalCft, slabsCount,
}: {
  groups: Array<{ vendor: string; rows: CncContributingSlab[]; sft: number; cft: number }>;
  totalSft: number;
  totalCft: number;
  slabsCount: number;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
          <th style={th()}>Size Code</th>
          <th style={th()}>Stone</th>
          <th style={{ ...th(), textAlign: "right" }}>Dimensions (in)</th>
          <th style={{ ...th(), textAlign: "right" }}>SFT</th>
          <th style={{ ...th(), textAlign: "right" }}>CFT</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.vendor}>
            <tr style={{ background: "#eef2ff", borderTop: "2px solid #6366f1" }}>
              <td colSpan={5} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, color: "#3730a3", letterSpacing: "0.03em" }}>
                <span>🧑‍🏭 {g.vendor}</span>
                <span style={{ marginLeft: 10, color: "#4f46e5", fontWeight: 600, fontSize: 11 }}>
                  · {g.rows.length} slab{g.rows.length === 1 ? "" : "s"}
                </span>
                <span style={{ float: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#3730a3" }}>
                  {fmtNum(g.sft)} SFT / {fmtNum(g.cft)} CFT
                </span>
              </td>
            </tr>
            {g.rows.map((s, i) => (
              <tr key={`${s.id}-${i}`} style={{ borderBottom: "1px solid #f1f5f9", background: "#fff" }}>
                <td style={{ ...td(), fontFamily: "ui-monospace, monospace", fontWeight: 600, paddingLeft: 28 }}>
                  {s.id}
                  {s.sides === 2 && <span style={badge()}>2-side</span>}
                </td>
                <td style={{ ...td(), color: "#64748b" }}>{s.stone ?? "—"}</td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{dims(s)}</td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmtNum(s.sft)}</td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{fmtNum(s.cft)}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ background: "#fffbeb", borderTop: "2px solid #d97706" }}>
          <td style={{ ...td(), fontWeight: 800 }} colSpan={3}>Total · {slabsCount} slab{slabsCount === 1 ? "" : "s"}</td>
          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{fmtNum(totalSft)}</td>
          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{fmtNum(totalCft)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function SortBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "6px 14px", fontSize: 12, fontWeight: 700,
        background: active ? "#fff" : "transparent", color: active ? "#0f172a" : "#64748b",
        border: "none", borderRadius: 999, cursor: active ? "default" : "pointer",
        boxShadow: active ? "0 1px 3px rgba(15,23,42,0.12)" : "none", transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function badge(): React.CSSProperties {
  return {
    marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#9a3412", background: "#ffedd5",
    padding: "1px 5px", borderRadius: 4, letterSpacing: "0.03em", verticalAlign: "middle",
  };
}

function th(): React.CSSProperties {
  return { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left" };
}
function td(): React.CSSProperties {
  return { padding: "8px 14px", fontSize: 12, color: "#0f172a" };
}
