"use client";

/**
 * Generic DPR section rendered as an authentic spreadsheet (Daksh: "exact
 * excel view … even row and column number"). Column letters A–G across the
 * top, row numbers 1.. down the left, gridlines, and coloured rows by tone:
 *   yellow = section header   orange = group (stone/temple)
 *   cyan = subtotal (CNC / Outsource total)   grey = item (vendor)   bold = TOTAL
 *
 * Drives Block Added (stone→vendor), Block Cutted and Carving Done
 * (temple→CNC/Outsource→vendor) — the data shape (DprSection lines) is shared.
 *
 * Each value cell shows CFT (or TONNES for tonnage stock like marble) and is
 * clickable — click flips it to the block/slab COUNT; click again for value.
 */

import { useState, type CSSProperties } from "react";
import type { DprSection, DprWin, DprWindows } from "@/lib/dpr-section";

type WinKey = "daily" | "week" | "month" | "allTime";
const WIN_ORDER: WinKey[] = ["daily", "week", "month", "allTime"];
const WIN_LABELS: Record<WinKey, string> = { daily: "DAILY", week: "7 DAYS", month: "MONTH", allTime: "ALL TIME" };
const COL_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

type Tone = "group" | "subtotal" | "item" | "total";
type Disp =
  | { kind: "blank" }
  | { kind: "header" }
  | { kind: "data"; id: string; tone: Tone; label: string; windows: DprWindows };

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DprGrid({
  report, title, shortUnit, longUnit,
}: {
  report: DprSection;
  /** Cell A2 text, e.g. "BLOCK CUTTED". */
  title: string;
  /** Compact count suffix in a cell, e.g. "blk" / "slab". */
  shortUnit: string;
  /** Noun for the tooltip, e.g. "block" / "slab". */
  longUnit: string;
}) {
  // Per-cell toggle — keys (`${rowId}:${win}`) currently flipped from default.
  const [asCount, setAsCount] = useState<Set<string>>(new Set());
  const flip = (key: string) =>
    setAsCount((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Flatten lines → display rows, inserting blank spacers (before each group,
  // and between two subgroups). Data rows get a counter id (collision-proof).
  let rid = 0;
  const disp: Disp[] = [{ kind: "blank" }, { kind: "header" }, { kind: "blank" }];
  let prevTone: Tone | null = null;
  let anyData = false;
  for (const ln of report.lines) {
    if (ln.tone === "group") { if (anyData) disp.push({ kind: "blank" }); }
    else if (ln.tone === "subtotal") { if (prevTone === "item") disp.push({ kind: "blank" }); }
    disp.push({ kind: "data", id: `d${rid++}`, tone: ln.tone, label: ln.label, windows: ln.windows });
    prevTone = ln.tone;
    anyData = true;
  }
  disp.push({ kind: "blank" });
  disp.push({ kind: "data", id: `d${rid++}`, tone: "total", label: "TOTAL", windows: report.total });
  disp.push({ kind: "blank" }, { kind: "blank" });

  if (report.lines.length === 0) {
    return (
      <div style={{ border: "1px solid #b6b6b6", borderRadius: 8, background: "#fff", padding: "16px 18px", fontSize: 13, color: "#555" }}>
        Nothing to show yet.
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
          {disp.map((r, i) => {
            const isTotal = r.kind === "data" && r.tone === "total";
            return (
              <tr key={i}>
                {/* Row number gutter — match the TOTAL row's heavy top rule */}
                <td style={isTotal ? { ...rowNumCell, borderTop: "2px solid #404040" } : rowNumCell}>{i + 1}</td>
                {r.kind === "blank" && COL_LETTERS.map((c) => <td key={c} style={blankCell} />)}
                {r.kind === "header" && (
                  <>
                    <td style={headerLabelCell}>{title}</td>
                    <td style={headerCell} />
                    {WIN_ORDER.map((w) => <td key={w} style={headerColCell}>{WIN_LABELS[w]}</td>)}
                    <td style={headerCell} />
                  </>
                )}
                {r.kind === "data" && (
                  <>
                    <td style={labelCell(r.tone)} title={r.label}>{r.label}</td>
                    <td style={bodyCell(r.tone)} />
                    {WIN_ORDER.map((w) => (
                      <DataCell key={w} rowId={r.id} tone={r.tone} win={w} data={r.windows[w]} shortUnit={shortUnit} longUnit={longUnit} asCount={asCount} flip={flip} />
                    ))}
                    <td style={bodyCell(r.tone)} />
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
  rowId, tone, win, data, shortUnit, longUnit, asCount, flip,
}: {
  rowId: string; tone: Tone; win: WinKey; data: DprWin;
  shortUnit: string; longUnit: string;
  asCount: Set<string>; flip: (k: string) => void;
}) {
  const key = `${rowId}:${win}`;
  const empty = data.count === 0;                                   // nothing in this window
  // Show CFT and/or TONNES — BOTH when a cell mixes them (e.g. the grand
  // TOTAL over sandstone + marble), so marble tonnage is never masked.
  const valParts: string[] = [];
  if (data.cft > 0) valParts.push(fmt(data.cft));
  if (data.tonnes > 0) valParts.push(`${fmt(data.tonnes)} T`);
  const value = valParts.length ? valParts.join(" + ") : null;
  const clickable = !empty && value !== null;                      // only flip when there IS a value
  const showCount = empty ? false : value === null ? true : asCount.has(key);
  const tipParts: string[] = [];
  if (data.cft > 0) tipParts.push(`${fmt(data.cft)} CFT`);
  if (data.tonnes > 0) tipParts.push(`${fmt(data.tonnes)} tonnes`);
  const valTip = tipParts.join(" + ");
  return (
    <td
      onClick={clickable ? () => flip(key) : undefined}
      title={empty ? undefined : `${valTip ? valTip + " · " : ""}${data.count} ${longUnit}${data.count === 1 ? "" : "s"}${clickable ? " (click to flip)" : ""}`}
      style={{ ...numCell(tone), cursor: clickable ? "pointer" : "default" }}
    >
      {empty ? "" : showCount ? (
        <span style={{ color: "#1d4ed8", fontWeight: 800 }}>
          {data.count}<span style={{ fontSize: 9, fontWeight: 700, marginLeft: 2 }}>{shortUnit}</span>
        </span>
      ) : (
        value
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

function rowBg(tone: Tone): string {
  return tone === "group" ? "#ed7d31" : tone === "subtotal" ? "#4dabf7" : tone === "item" ? "#d4d4d4" : "#ffffff";
}
function bodyCell(tone: Tone): CSSProperties {
  return { border: GRID, background: rowBg(tone), height: 24, ...(tone === "total" ? { borderTop: "2px solid #404040" } : {}) };
}
function labelCell(tone: Tone): CSSProperties {
  return {
    ...bodyCell(tone),
    padding: "4px 8px",
    fontWeight: tone === "item" ? 600 : 800,
    color: "#1a1a1a",
    textTransform: "uppercase",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };
}
function numCell(tone: Tone): CSSProperties {
  return {
    ...bodyCell(tone),
    padding: "4px 8px",
    textAlign: "right",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontWeight: tone === "total" ? 800 : tone === "item" ? 500 : 700,
    color: "#1a1a1a",
  };
}
