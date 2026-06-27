"use client";

/**
 * "Block Added" section rendered as an authentic spreadsheet (Daksh: "exact
 * excel view … even row and column number"). Column letters A–G across the
 * top, row numbers 1.. down the left, gridlines, and coloured rows:
 *   yellow = section header   orange = stone   grey = vendor   bold = TOTAL
 *
 * Every CFT cell is clickable — click flips it to the block COUNT (Daksh:
 * "if i press shell … it will show quantity eg 5 blocks"); click again for CFT.
 */

import { useState, type CSSProperties } from "react";
import type { BlockAddedReport, DprWin, DprWindows } from "@/lib/dpr-block-added";

type WinKey = "daily" | "week" | "month" | "allTime";
const WIN_ORDER: WinKey[] = ["daily", "week", "month", "allTime"];
const WIN_LABELS: Record<WinKey, string> = { daily: "DAILY", week: "7 DAYS", month: "MONTH", allTime: "ALL TIME" };

type Row =
  | { kind: "blank" }
  | { kind: "header" }
  | { kind: "data"; id: string; type: "stone" | "vendor" | "total"; label: string; windows: DprWindows };

const COL_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

function fmtCft(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BlockAddedGrid({ report }: { report: BlockAddedReport }) {
  // Per-cell toggle — keys (`${rowId}:${winKey}`) currently showing COUNT.
  const [asCount, setAsCount] = useState<Set<string>>(new Set());
  const flip = (key: string) =>
    setAsCount((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Build the logical row list (blank spacers reproduce the screenshot).
  // Data rows get a counter id (collision-proof vs any ':' in a name; the
  // per-cell toggle state keys off it).
  let rid = 0;
  const rows: Row[] = [{ kind: "blank" }, { kind: "header" }, { kind: "blank" }];
  for (const s of report.stones) {
    rows.push({ kind: "data", id: `d${rid++}`, type: "stone", label: s.stone, windows: s.windows });
    for (const v of s.vendors) {
      rows.push({ kind: "data", id: `d${rid++}`, type: "vendor", label: v.vendor, windows: v.windows });
    }
    rows.push({ kind: "blank" });
  }
  rows.push({ kind: "data", id: `d${rid++}`, type: "total", label: "TOTAL", windows: report.total });
  rows.push({ kind: "blank" }, { kind: "blank" });

  if (report.stones.length === 0) {
    return (
      <div style={{ border: "1px solid #b6b6b6", borderRadius: 8, background: "#fff", padding: "16px 18px", fontSize: 13, color: "#555" }}>
        No blocks have been added yet.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", border: "1px solid #b6b6b6", borderRadius: 8, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, color: "#1a1a1a", tableLayout: "fixed", minWidth: 720 }}>
        <colgroup>
          <col style={{ width: 38 }} />
          <col style={{ width: 300 }} />
          <col style={{ width: 58 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 58 }} />
        </colgroup>
        {/* Column-letter header (A–G) */}
        <thead>
          <tr>
            <th style={cornerCell} />
            {COL_LETTERS.map((c) => (
              <th key={c} style={colHeadCell}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isTotal = r.kind === "data" && r.type === "total";
            return (
              <tr key={i}>
                {/* Row number gutter — match the TOTAL row's heavy top rule */}
                <td style={isTotal ? { ...rowNumCell, borderTop: "2px solid #404040" } : rowNumCell}>{i + 1}</td>
                {r.kind === "blank" && COL_LETTERS.map((c) => <td key={c} style={blankCell} />)}
                {r.kind === "header" && (
                  <>
                    <td style={headerLabelCell}>BLOCK ADDED</td>
                    <td style={headerCell} />
                    {WIN_ORDER.map((w) => <td key={w} style={headerColCell}>{WIN_LABELS[w]}</td>)}
                    <td style={headerCell} />
                  </>
                )}
                {r.kind === "data" && (
                  <>
                    <td style={labelCell(r.type)} title={r.label}>{r.label}</td>
                    <td style={bodyCell(r.type)} />
                    {WIN_ORDER.map((w) => (
                      <DataCell key={w} rowId={r.id} type={r.type} win={w} data={r.windows[w]} asCount={asCount} flip={flip} />
                    ))}
                    <td style={bodyCell(r.type)} />
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataCell({
  rowId, type, win, data, asCount, flip,
}: {
  rowId: string; type: "stone" | "vendor" | "total"; win: WinKey; data: DprWin;
  asCount: Set<string>; flip: (k: string) => void;
}) {
  const key = `${rowId}:${win}`;
  const empty = data.count === 0;          // nothing added in this window
  const zeroCft = data.cft === 0;          // tonnage block (marble) — count>0 here
  // Default view is CFT, EXCEPT a zero-CFT cell defaults to the block count so
  // tonnage/marble production isn't hidden behind a misleading "0.00". Clicking
  // flips either kind of cell to the other reading.
  const showCount = empty ? false : zeroCft ? !asCount.has(key) : asCount.has(key);
  return (
    <td
      onClick={empty ? undefined : () => flip(key)}
      title={empty ? undefined : `${fmtCft(data.cft)} CFT · ${data.count} block${data.count === 1 ? "" : "s"} (click to flip)`}
      style={{ ...numCell(type), cursor: empty ? "default" : "pointer" }}
    >
      {empty ? "" : showCount ? (
        <span style={{ color: "#1d4ed8", fontWeight: 800 }}>
          {data.count}<span style={{ fontSize: 9, fontWeight: 700, marginLeft: 2 }}>blk</span>
        </span>
      ) : (
        fmtCft(data.cft)
      )}
    </td>
  );
}

// ── cell styles (spreadsheet chrome) ────────────────────────────────────
const GRID = "1px solid #d4d4d4";
const HEAD_BG = "#e9e9e9";

const cornerCell: CSSProperties = { width: 38, background: HEAD_BG, border: GRID, padding: 0 };
const colHeadCell: CSSProperties = { background: HEAD_BG, border: GRID, color: "#5a5a5a", fontWeight: 700, textAlign: "center", padding: "3px 0", fontSize: 11 };
const rowNumCell: CSSProperties = { background: "#f1f1f1", border: GRID, color: "#8a8a8a", fontWeight: 600, textAlign: "center", fontSize: 10.5, width: 38 };
const blankCell: CSSProperties = { border: GRID, background: "#fff", height: 22 };

const headerCell: CSSProperties = { border: GRID, background: "#ffe600", height: 24 };
const headerLabelCell: CSSProperties = { ...headerCell, fontWeight: 800, color: "#1a1a1a", padding: "4px 8px", letterSpacing: "0.02em" };
const headerColCell: CSSProperties = { ...headerCell, fontWeight: 800, color: "#1a1a1a", textAlign: "right", padding: "4px 8px" };

function rowBg(type: "stone" | "vendor" | "total"): string {
  return type === "stone" ? "#ed7d31" : type === "vendor" ? "#d4d4d4" : "#ffffff";
}
function bodyCell(type: "stone" | "vendor" | "total"): CSSProperties {
  return { border: GRID, background: rowBg(type), height: 24, ...(type === "total" ? { borderTop: "2px solid #404040" } : {}) };
}
function labelCell(type: "stone" | "vendor" | "total"): CSSProperties {
  return {
    ...bodyCell(type),
    padding: "4px 8px",
    fontWeight: type === "vendor" ? 600 : 800,
    color: "#1a1a1a",
    textTransform: "uppercase",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };
}
function numCell(type: "stone" | "vendor" | "total"): CSSProperties {
  return {
    ...bodyCell(type),
    padding: "4px 8px",
    textAlign: "right",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontWeight: type === "total" ? 800 : type === "stone" ? 700 : 500,
    color: "#1a1a1a",
  };
}
