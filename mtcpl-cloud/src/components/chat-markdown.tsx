"use client";

/**
 * Renders a Claude reply with:
 *   - GitHub-flavoured markdown (tables, bold, lists, code, etc.)
 *   - Inline widgets triggered by [[KIND:JSON]] markers Claude emits
 *
 * Supported markers:
 *
 *   [[CHART:{"type":"bar"|"donut", "title"?: "...", "bars": [...]}]]
 *   [[BLOCK:{"id":"MT-B-042", "dimensions":"...", "cft":...,
 *            "stone":"...", "yard":..., "facility":"mtcpl"|"riico",
 *            "status":"...", "quality":"..."}]]
 *
 * Incomplete markers (during streaming) are left as plain text; once the
 * closing `]]` arrives on a later chunk the regex matches and the widget
 * swaps in. A tiny flash but no broken layouts.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";

import { ChartBar, type ChartBarItem } from "./chat-widgets/chart-bar";
import { ChartDonut, type DonutSlice } from "./chat-widgets/chart-donut";
import { BlockCard, type BlockCardProps } from "./chat-widgets/block-card";
import { StatsTiles, type StatTile } from "./chat-widgets/stats-tiles";
import { FollowUps } from "./chat-widgets/follow-ups";
import { TempleCard, type TempleCardProps } from "./chat-widgets/temple-card";
import { LinkButton, type LinkButtonProps } from "./chat-widgets/link-button";
import { SlabCard, type SlabCardProps } from "./chat-widgets/slab-card";

const START_RE = /\[\[(CHART|BLOCK|STATS|FOLLOWUPS|TEMPLE|LINK|SLAB):/g;

type Part =
  | { kind: "md"; text: string }
  | { kind: "chart-bar"; title?: string; bars: ChartBarItem[] }
  | { kind: "chart-donut"; title?: string; slices: DonutSlice[] }
  | { kind: "block"; props: BlockCardProps }
  | { kind: "stats"; tiles: StatTile[] }
  | { kind: "followups"; questions: string[] }
  | { kind: "temple"; props: TempleCardProps }
  | { kind: "slab"; props: SlabCardProps }
  | { kind: "link"; props: LinkButtonProps }
  | { kind: "err"; text: string }; // marker present but JSON bad → show as-is

/**
 * Walk forward from `start` tracking bracket depth and string state to find
 * the matching `]]` that closes the marker. Returns the index ONE PAST `]]`
 * (i.e. where the next character after the marker begins), or -1 if we
 * never find a valid close (marker still streaming).
 *
 * Regex-only solutions break when the payload itself contains `]]` — e.g.
 * a JSON array ending with `...}]]]` where the first two `]]` belong to the
 * array and the third belongs to the marker. This scanner skips `]` inside
 * strings, counts `[…]` depth, and only ends when it sees `]]` at depth 0.
 */
function findMarkerEnd(src: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "[") { depth++; continue; }
    if (c === "]") {
      if (depth > 0) { depth--; continue; }
      // depth 0: this `]` can only belong to the marker close. Check for `]]`.
      if (src[i + 1] === "]") return i + 2;
      // Stray `]` at depth 0 is malformed — keep scanning, regex would never
      // have matched a close here either.
    }
  }
  return -1;
}

function splitByMarkers(src: string): Part[] {
  const parts: Part[] = [];
  let lastIdx = 0;
  START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START_RE.exec(src)) !== null) {
    const startIdx = m.index;
    const kind = m[1];
    const contentStart = startIdx + m[0].length;

    const endIdx = findMarkerEnd(src, contentStart);
    if (endIdx === -1) {
      // Incomplete marker (streaming mid-way) — leave the rest as text; the
      // next chunk will complete it and the parser will re-run.
      break;
    }

    if (startIdx > lastIdx) parts.push({ kind: "md", text: src.slice(lastIdx, startIdx) });

    const rawJson = src.slice(contentStart, endIdx - 2);
    try {
      const data = JSON.parse(rawJson);
      if (kind === "CHART") {
        const d = data as Record<string, unknown>;
        const type = (d.type as string) || "bar";
        const title = typeof d.title === "string" ? d.title : undefined;
        if (type === "donut") {
          const slices = Array.isArray(d.slices) ? (d.slices as DonutSlice[]) : [];
          parts.push({ kind: "chart-donut", title, slices });
        } else {
          const bars = Array.isArray(d.bars) ? (d.bars as ChartBarItem[]) : [];
          parts.push({ kind: "chart-bar", title, bars });
        }
      } else if (kind === "BLOCK") {
        parts.push({ kind: "block", props: data as BlockCardProps });
      } else if (kind === "STATS") {
        const tiles = Array.isArray(data)
          ? (data as StatTile[])
          : Array.isArray((data as { tiles?: unknown }).tiles)
            ? ((data as { tiles: StatTile[] }).tiles)
            : [];
        parts.push({ kind: "stats", tiles });
      } else if (kind === "FOLLOWUPS") {
        const questions = Array.isArray(data)
          ? (data as string[])
          : Array.isArray((data as { questions?: unknown }).questions)
            ? ((data as { questions: string[] }).questions)
            : [];
        parts.push({ kind: "followups", questions: questions.filter((q) => typeof q === "string") });
      } else if (kind === "TEMPLE") {
        parts.push({ kind: "temple", props: data as TempleCardProps });
      } else if (kind === "SLAB") {
        parts.push({ kind: "slab", props: data as SlabCardProps });
      } else if (kind === "LINK") {
        const p = data as LinkButtonProps;
        // Only accept safe hrefs — in-app paths or http(s) URLs
        if (typeof p.href === "string" && typeof p.label === "string" &&
            (p.href.startsWith("/") || /^https?:\/\//.test(p.href))) {
          parts.push({ kind: "link", props: p });
        } else {
          parts.push({ kind: "err", text: src.slice(startIdx, endIdx) });
        }
      }
    } catch {
      // JSON didn't parse — keep the raw marker text so it's visible for debug
      parts.push({ kind: "err", text: src.slice(startIdx, endIdx) });
    }

    lastIdx = endIdx;
    START_RE.lastIndex = endIdx;
  }
  if (lastIdx < src.length) parts.push({ kind: "md", text: src.slice(lastIdx) });
  return parts;
}

// Styled markdown renderers — dark palette, tight spacing for chat bubbles
const mdComponents: Components = {
  p: ({ children }) => <p style={{ margin: "0.5em 0", lineHeight: 1.65 }}>{children}</p>,
  h1: ({ children }) => <h3 style={{ fontSize: 19, fontWeight: 700, margin: "0.6em 0 0.3em", color: "#f5f5f5" }}>{children}</h3>,
  h2: ({ children }) => <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0.6em 0 0.3em", color: "#f5f5f5" }}>{children}</h3>,
  h3: ({ children }) => <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0.6em 0 0.3em", color: "#f0f0f0" }}>{children}</h4>,
  h4: ({ children }) => <h5 style={{ fontSize: 14, fontWeight: 700, margin: "0.5em 0 0.2em", color: "#e8e8e8" }}>{children}</h5>,
  strong: ({ children }) => <strong style={{ color: "#fff", fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: "rgba(255,255,255,0.85)" }}>{children}</em>,
  ul: ({ children }) => <ul style={{ margin: "0.4em 0", paddingLeft: "1.4em", display: "flex", flexDirection: "column", gap: 3 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0.4em 0", paddingLeft: "1.4em", display: "flex", flexDirection: "column", gap: 3 }}>{children}</ol>,
  li: ({ children }) => <li style={{ lineHeight: 1.6 }}>{children}</li>,
  code: ({ children, ...props }) => {
    // @ts-expect-error - react-markdown passes `inline` at runtime but no type for it
    const inline = props.inline;
    if (inline) {
      return (
        <code style={{
          background: "rgba(255,255,255,0.08)",
          color: "#E8C572",
          padding: "1px 6px",
          borderRadius: 4,
          fontSize: "0.92em",
          fontFamily: "ui-monospace, monospace",
        }}>
          {children}
        </code>
      );
    }
    return (
      <pre style={{
        background: "rgba(0,0,0,0.35)",
        color: "#e8e8e8",
        padding: "10px 12px",
        borderRadius: 8,
        overflowX: "auto",
        fontSize: 13,
        lineHeight: 1.5,
        margin: "0.6em 0",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <code style={{ fontFamily: "ui-monospace, monospace" }}>{children}</code>
      </pre>
    );
  },
  table: ({ children }) => <TableWithCopy>{children}</TableWithCopy>,
  thead: ({ children }) => <thead style={{ background: "rgba(255,255,255,0.06)" }}>{children}</thead>,
  th: ({ children }) => (
    <th style={{
      padding: "9px 12px",
      textAlign: "left",
      fontWeight: 700,
      color: "rgba(255,255,255,0.8)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
    }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{
      padding: "9px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      color: "rgba(255,255,255,0.85)",
      verticalAlign: "top",
    }}>
      {children}
    </td>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#E8C572", textDecoration: "none", borderBottom: "1px dotted rgba(232,197,114,0.4)" }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: "3px solid rgba(232,197,114,0.5)",
      margin: "0.5em 0",
      padding: "0.2em 0 0.2em 0.9em",
      color: "rgba(255,255,255,0.75)",
      fontStyle: "italic",
    }}>
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "0.8em 0" }} />,
};

/**
 * Wraps a rendered markdown table with a subtle copy-to-clipboard button.
 * On click, reads the table's DOM text, converts to tab-separated rows
 * (Excel / WhatsApp friendly) and writes to the clipboard.
 */
function TableWithCopy({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  function readRows(): string[][] {
    const tbl = wrapRef.current?.querySelector("table");
    if (!tbl) return [];
    const rows: string[][] = [];
    tbl.querySelectorAll("tr").forEach((tr) => {
      const cells = tr.querySelectorAll("th, td");
      const cols: string[] = [];
      cells.forEach((c) => cols.push((c.textContent || "").trim()));
      rows.push(cols);
    });
    return rows;
  }

  function handleCopy() {
    const rows = readRows();
    if (rows.length === 0) return;
    const text = rows.map((r) => r.join("\t")).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard API denied — silently no-op */
      },
    );
  }

  function handleExcel() {
    const rows = readRows();
    if (rows.length === 0) return;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Widen each column a bit so dimensions / long labels aren't clipped
    ws["!cols"] = rows[0].map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MTCPL-AI");
    const ts = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `mtcpl-ai-${ts}.xlsx`);
  }

  const btnBase: React.CSSProperties = {
    padding: "3px 8px",
    fontSize: 10,
    fontWeight: 600,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.6)",
    borderRadius: 5,
    cursor: "pointer",
    transition: "all 0.15s",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", margin: "0.8em 0" }}>
      <div style={{
        position: "absolute",
        top: 6,
        right: 6,
        zIndex: 2,
        display: "flex",
        gap: 4,
      }}>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy table as tab-separated"}
          style={{
            ...btnBase,
            background: copied ? "rgba(22,163,74,0.2)" : btnBase.background,
            color: copied ? "#4ade80" : btnBase.color,
            border: copied ? "1px solid rgba(22,163,74,0.5)" : (btnBase.border as string),
          }}
        >
          {copied ? "Copied ✓" : "📋 Copy"}
        </button>
        <button
          type="button"
          onClick={handleExcel}
          title="Download as Excel"
          style={btnBase}
        >
          ⬇ Excel
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          overflow: "hidden",
        }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function ChatMarkdown({
  content,
  onFollowUp,
  followUpsDisabled,
}: {
  content: string;
  onFollowUp?: (q: string) => void;
  followUpsDisabled?: boolean;
}) {
  const parts = splitByMarkers(content);

  // Group consecutive LINK markers so they lay out in one row (Claude often
  // emits 2-3 links together and we want them to wrap on one line, not stack).
  const renderable: Array<Part | { kind: "link-group"; links: LinkButtonProps[] }> = [];
  for (const p of parts) {
    if (p.kind === "link") {
      const last = renderable[renderable.length - 1];
      if (last && (last as { kind: string }).kind === "link-group") {
        (last as { kind: "link-group"; links: LinkButtonProps[] }).links.push(p.props);
      } else {
        renderable.push({ kind: "link-group", links: [p.props] });
      }
    } else {
      renderable.push(p);
    }
  }

  return (
    <>
      {renderable.map((p, i) => {
        if (p.kind === "md") {
          return (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>
              {p.text}
            </ReactMarkdown>
          );
        }
        if (p.kind === "chart-bar") return <ChartBar key={i} title={p.title} bars={p.bars} />;
        if (p.kind === "chart-donut") return <ChartDonut key={i} title={p.title} slices={p.slices} />;
        if (p.kind === "block") return <BlockCard key={i} {...p.props} />;
        if (p.kind === "temple") return <TempleCard key={i} {...p.props} />;
        if (p.kind === "slab") return <SlabCard key={i} {...p.props} />;
        if (p.kind === "stats") return <StatsTiles key={i} tiles={p.tiles} />;
        if (p.kind === "link-group") {
          return (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
              {p.links.map((l, j) => <LinkButton key={j} {...l} />)}
            </div>
          );
        }
        if (p.kind === "followups") {
          if (!onFollowUp) return null;
          return (
            <FollowUps
              key={i}
              questions={p.questions}
              onPick={onFollowUp}
              disabled={followUpsDisabled}
            />
          );
        }
        if (p.kind === "link") {
          // Stray — normally grouped above. Render inline as a safety fallback.
          return <LinkButton key={i} {...p.props} />;
        }
        // err — show the broken marker so it's visible
        return (
          <pre key={i} style={{ fontSize: 11, color: "#fca5a5", whiteSpace: "pre-wrap", margin: "0.4em 0" }}>
            {p.text}
          </pre>
        );
      })}
    </>
  );
}
