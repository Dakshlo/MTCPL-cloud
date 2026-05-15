"use client";

/**
 * Compact inline card for a single slab requirement. Triggered by:
 *
 *   [[SLAB:{"id":"AST-0042","label":"Main Hall Floor Panel",
 *           "temple":"Aasta Temple","dimensions":"48 × 36 × 2 in",
 *           "stone":"PinkStone","quality":"A","priority":true,
 *           "status":"open","deadline":"2026-05-01"}]]
 *
 * Clicking opens /slabs (the Required Sizes page groups by temple so the
 * user can scroll to the right row).
 */

import Link from "next/link";

export type SlabCardProps = {
  id: string;
  label?: string;
  description?: string;
  temple?: string;
  dimensions?: string;
  stone?: string | null;
  quality?: string | null;
  priority?: boolean;
  status?: string | null;
  deadline?: string | null;
};

function statusLook(status?: string | null): { bg: string; fg: string; label: string } {
  const s = (status || "").toLowerCase();
  if (s === "open") return { bg: "rgba(217,119,6,0.15)", fg: "#f59e0b", label: "Open" };
  if (s === "planned") return { bg: "rgba(37,99,235,0.15)", fg: "#60a5fa", label: "Planned" };
  if (s === "cutting") return { bg: "rgba(220,38,38,0.15)", fg: "#fca5a5", label: "Cutting" };
  if (s === "cut_done") return { bg: "rgba(22,163,74,0.15)", fg: "#4ade80", label: "Cut done" };
  if (s === "completed") return { bg: "rgba(22,163,74,0.2)", fg: "#4ade80", label: "Completed" };
  if (s === "rejected") return { bg: "rgba(100,116,139,0.15)", fg: "#94a3b8", label: "Rejected" };
  return { bg: "rgba(255,255,255,0.06)", fg: "rgba(255,255,255,0.5)", label: status || "—" };
}

function stoneColor(stone?: string | null): string {
  if (stone === "PinkStone") return "#C87A60";
  if (stone === "WhiteStone") return "#B8B6AC";
  return "#9CA3AF";
}

export function SlabCard(props: SlabCardProps) {
  const { id, label, temple, dimensions, stone, quality, priority, status, deadline } = props;
  const st = statusLook(status);
  const stoneCol = stoneColor(stone);

  return (
    <Link
      href="/slabs"
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
            {priority && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#fca5a5",
                background: "rgba(220,38,38,0.15)",
                padding: "2px 7px",
                borderRadius: 10,
                border: "1px solid rgba(220,38,38,0.4)",
              }}>
                ⚡ Urgent
              </span>
            )}
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
          {label && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", marginBottom: 2 }}>
              {label}
            </div>
          )}
          {(temple || dimensions) && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "ui-monospace, monospace" }}>
              {temple && <>🏛️ {temple}</>}
              {temple && dimensions && <span style={{ color: "rgba(255,255,255,0.3)", margin: "0 8px" }}>·</span>}
              {dimensions}
            </div>
          )}
          {deadline && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
              ⏱ Deadline: {new Date(deadline).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
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
