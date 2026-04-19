"use client";

/**
 * Compact inline card for a single temple. Triggered by:
 *
 *   [[TEMPLE:{"name":"Aasta Temple","openSlabCount":45,"priorityCount":6,"totalCft":320.5}]]
 *
 * Clicking it opens /slabs (which groups by temple so you land at the
 * right group).
 */

import Link from "next/link";

export type TempleCardProps = {
  name: string;
  openSlabCount?: number;
  priorityCount?: number;
  totalCft?: number;
  note?: string;
};

export function TempleCard({ name, openSlabCount, priorityCount, totalCft, note }: TempleCardProps) {
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
            <span style={{ fontSize: 16 }}>🏛️</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e8e8" }}>
              {name}
            </span>
            {typeof priorityCount === "number" && priorityCount > 0 && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#fca5a5",
                background: "rgba(220,38,38,0.15)",
                padding: "2px 7px",
                borderRadius: 10,
                border: "1px solid rgba(220,38,38,0.4)",
              }}>
                ⚡ {priorityCount} urgent
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            {typeof openSlabCount === "number" && (
              <>
                <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>{openSlabCount}</span>{" "}
                open slab{openSlabCount === 1 ? "" : "s"}
              </>
            )}
            {typeof openSlabCount === "number" && typeof totalCft === "number" && (
              <span style={{ color: "rgba(255,255,255,0.3)", margin: "0 8px" }}>·</span>
            )}
            {typeof totalCft === "number" && (
              <>
                <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>{totalCft.toFixed(2)} CFT</span>
              </>
            )}
          </div>
          {note && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
              {note}
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
