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

import { ChartBar, type ChartBarItem } from "./chat-widgets/chart-bar";
import { ChartDonut, type DonutSlice } from "./chat-widgets/chart-donut";
import { BlockCard, type BlockCardProps } from "./chat-widgets/block-card";

const MARKER_RE = /\[\[(CHART|BLOCK):((?:(?!\]\])[\s\S])*?)\]\]/g;

type Part =
  | { kind: "md"; text: string }
  | { kind: "chart-bar"; title?: string; bars: ChartBarItem[] }
  | { kind: "chart-donut"; title?: string; slices: DonutSlice[] }
  | { kind: "block"; props: BlockCardProps }
  | { kind: "err"; text: string }; // marker present but JSON bad → show as-is

function splitByMarkers(src: string): Part[] {
  const parts: Part[] = [];
  let lastIdx = 0;
  for (const match of src.matchAll(MARKER_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) parts.push({ kind: "md", text: src.slice(lastIdx, idx) });

    const kind = match[1];
    const rawJson = match[2];
    try {
      const data = JSON.parse(rawJson) as Record<string, unknown>;
      if (kind === "CHART") {
        const type = (data.type as string) || "bar";
        const title = typeof data.title === "string" ? data.title : undefined;
        if (type === "donut") {
          const slices = Array.isArray(data.slices) ? (data.slices as DonutSlice[]) : [];
          parts.push({ kind: "chart-donut", title, slices });
        } else {
          const bars = Array.isArray(data.bars) ? (data.bars as ChartBarItem[]) : [];
          parts.push({ kind: "chart-bar", title, bars });
        }
      } else if (kind === "BLOCK") {
        parts.push({ kind: "block", props: data as BlockCardProps });
      }
    } catch {
      // Bad JSON → keep the raw marker text so it's at least visible
      parts.push({ kind: "err", text: match[0] });
    }
    lastIdx = idx + match[0].length;
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
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.8em 0" }}>
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
  ),
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

export function ChatMarkdown({ content }: { content: string }) {
  const parts = splitByMarkers(content);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "md") {
          return (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>
              {p.text}
            </ReactMarkdown>
          );
        }
        if (p.kind === "chart-bar") {
          return <ChartBar key={i} title={p.title} bars={p.bars} />;
        }
        if (p.kind === "chart-donut") {
          return <ChartDonut key={i} title={p.title} slices={p.slices} />;
        }
        if (p.kind === "block") {
          return <BlockCard key={i} {...p.props} />;
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
