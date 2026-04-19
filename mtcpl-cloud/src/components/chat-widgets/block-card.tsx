"use client";

/**
 * Compact inline card for a single block. Triggered by
 * `[[BLOCK:{"id":"MT-B-042", ...}]]` in an assistant reply.
 *
 * Clicking the card takes you to /blocks/report with the block code
 * pre-filtered so you land on the exact row.
 */

import Link from "next/link";

export type BlockCardProps = {
  id: string;
  dimensions?: string; // "120 × 54 × 27 in"
  cft?: number;
  stone?: string | null;
  yard?: number | null;
  facility?: "mtcpl" | "riico" | string | null;
  status?: string | null;
  quality?: string | null;
};

function statusColor(status?: string | null): { bg: string; fg: string; label: string } {
  const s = (status || "").toLowerCase();
  if (s === "available") return { bg: "rgba(22,163,74,0.15)", fg: "#4ade80", label: "Available" };
  if (s === "reserved") return { bg: "rgba(217,119,6,0.15)", fg: "#f59e0b", label: "Reserved" };
  if (s === "consumed") return { bg: "rgba(100,116,139,0.15)", fg: "#94a3b8", label: "Consumed" };
  if (s === "discarded") return { bg: "rgba(220,38,38,0.12)", fg: "#fca5a5", label: "Discarded" };
  return { bg: "rgba(255,255,255,0.06)", fg: "rgba(255,255,255,0.5)", label: status || "—" };
}

function stoneColor(stone?: string | null): string {
  if (stone === "PinkStone") return "#C87A60";
  if (stone === "WhiteStone") return "#B8B6AC";
  return "#9CA3AF";
}

export function BlockCard(props: BlockCardProps) {
  const { id, dimensions, cft, stone, yard, facility, status, quality } = props;
  const st = statusColor(status);
  const stoneCol = stoneColor(stone);

  const fac = (facility || "").toLowerCase();
  const facLabel = fac === "riico" ? "RIICO" : fac === "mtcpl" ? "MTCPL" : "";

  return (
    <Link
      href={`/blocks/report?block=${encodeURIComponent(id)}`}
      target="_blank"
      style={{
        display: "block",
        textDecoration: "none",
        margin: "10px 0",
        padding: "12px 14px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.07)";
        e.currentTarget.style.borderColor = "rgba(232,197,114,0.4)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <code style={{ fontSize: 14, fontWeight: 700, color: "#e8e8e8", fontFamily: "ui-monospace, monospace" }}>
              {id}
            </code>
            {stone && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#1a1a1a",
                background: stoneCol,
                padding: "2px 7px",
                borderRadius: 10,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}>
                {stone.replace(/Stone$/i, "")}
              </span>
            )}
            {quality && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: quality === "A" ? "#4ade80" : "#f59e0b",
                background: quality === "A" ? "rgba(22,163,74,0.15)" : "rgba(217,119,6,0.15)",
                padding: "2px 7px",
                borderRadius: 10,
                border: `1px solid ${quality === "A" ? "rgba(22,163,74,0.4)" : "rgba(217,119,6,0.4)"}`,
              }}>
                Grade {quality}
              </span>
            )}
            {status && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: st.fg,
                background: st.bg,
                padding: "2px 7px",
                borderRadius: 10,
              }}>
                {st.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: "ui-monospace, monospace" }}>
            {dimensions}
            {typeof cft === "number" && (
              <>
                <span style={{ color: "rgba(255,255,255,0.3)", margin: "0 8px" }}>·</span>
                <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>{cft.toFixed(2)} CFT</span>
              </>
            )}
          </div>
          {(yard != null || facLabel) && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
              {facLabel}{facLabel && yard != null ? " · " : ""}{yard != null ? `Yard ${yard}` : ""}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#E8C572", fontWeight: 600, whiteSpace: "nowrap", alignSelf: "flex-end" }}>
          Open →
        </div>
      </div>
    </Link>
  );
}
