"use client";

/**
 * Page-level "Print Report" button for the Cutting page.
 *
 * The report is scoped to whichever tab the owner is currently on —
 * Pending Approval prints pending-only, In Progress prints in-progress-only,
 * Done today prints today's completed cuts. The user asked for this:
 *   "when i do print report on pending approval it will only give pending
 *    approval list and when i will print report on in progress it will
 *    only give in progress report."
 *
 * Clicking the button opens a small popover asking which facility to
 * include (MTCPL only / RIICO only / Both). The facility choice lives
 * behind one click to keep the cutting page itself uncluttered.
 */

import { useEffect, useRef, useState } from "react";

type Facility = "mtcpl" | "riico" | "both";
export type CuttingTab = "pending" | "in_progress" | "done";

const TAB_LABELS: Record<CuttingTab, string> = {
  pending: "Pending Approval",
  in_progress: "In Progress",
  done: "Done today",
};

export function PrintReportButton({ tab }: { tab: CuttingTab }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handlePick(facility: Facility) {
    setOpen(false);
    window.open(
      `/cutting/list-print?facility=${facility}&tab=${tab}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const activeLabel = TAB_LABELS[tab];

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 13,
          fontWeight: 600,
          padding: "8px 16px",
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold-dark)",
          borderRadius: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        title={`Print a report of ${activeLabel.toLowerCase()} blocks`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        🖨 Print {activeLabel} {open ? "▲" : "▼"}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 50,
            minWidth: 240,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 6,
          }}
        >
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "6px 10px 4px",
          }}>
            Which facility?
          </div>
          <PickItem label="MTCPL only" hint="Yards 1–6 + Open Yard" onClick={() => handlePick("mtcpl")} />
          <PickItem label="RIICO only" hint="Yards 7, 8" onClick={() => handlePick("riico")} />
          <PickItem label="Both facilities" hint="MTCPL + RIICO together" onClick={() => handlePick("both")} />
          <div style={{
            fontSize: 10,
            color: "var(--muted)",
            padding: "6px 10px 4px",
            borderTop: "1px solid var(--border)",
            marginTop: 2,
          }}>
            Includes: <strong style={{ color: "var(--text)" }}>{activeLabel}</strong> only
          </div>
        </div>
      )}
    </div>
  );
}

function PickItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: "transparent",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        color: "var(--text)",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{hint}</div>
    </button>
  );
}
