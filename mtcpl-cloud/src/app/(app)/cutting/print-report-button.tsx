"use client";

/**
 * Page-level "Print Report" button for the Cutting page.
 *
 * Two modes depending on whether any block checkboxes are ticked:
 *
 *   - No selection  → button reads "🖨 Print In Progress" (for example),
 *                     prints every block in the current tab.
 *   - Selection on  → button reads "🖨 Print 4 Selected", prints only
 *                     the ticked blocks regardless of tab.
 *
 * Clicking the button opens a popover asking which facility to include
 * (MTCPL / RIICO / Both). A sibling "Clear" button appears when there's
 * an active selection so the owner can reset without un-ticking boxes
 * one by one.
 */

import { useEffect, useRef, useState } from "react";
import { useSelection } from "./selection-context";

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
  const { selected, clear } = useSelection();
  const hasSelection = selected.size > 0;

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
    const params = new URLSearchParams({ facility, tab });
    if (hasSelection) {
      params.set("blocks", Array.from(selected).join(","));
    }
    window.open(
      `/cutting/list-print?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const activeLabel = TAB_LABELS[tab];
  const buttonLabel = hasSelection
    ? `Print ${selected.size} Selected`
    : `Print ${activeLabel}`;
  const scopeDescription = hasSelection
    ? (<><strong style={{ color: "var(--text)" }}>{selected.size}</strong> selected block{selected.size !== 1 ? "s" : ""}</>)
    : (<>all <strong style={{ color: "var(--text)" }}>{activeLabel}</strong> blocks</>);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {hasSelection && (
        <button
          type="button"
          onClick={clear}
          title="Clear all selected blocks"
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: "7px 12px",
            background: "transparent",
            color: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ✕ Clear ({selected.size})
        </button>
      )}

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
          title={hasSelection
            ? `Print a report of the ${selected.size} selected block${selected.size !== 1 ? "s" : ""}`
            : `Print a report of all ${activeLabel.toLowerCase()} blocks`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          🖨 {buttonLabel} {open ? "▲" : "▼"}
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              minWidth: 260,
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
              lineHeight: 1.5,
            }}>
              Includes: {scopeDescription}
              {!hasSelection && (
                <div style={{ marginTop: 3, fontSize: 10, color: "var(--muted)", opacity: 0.8 }}>
                  Tip: tick the boxes on cards to print only those.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
