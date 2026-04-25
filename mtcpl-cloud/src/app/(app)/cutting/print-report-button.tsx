"use client";

/**
 * Page-level "Print Report" button for the Cutting page.
 *
 * Two stages:
 *
 *   Stage 1 (default / normal)
 *     Button label:   "🖨 Print In Progress ▼"
 *     Popover shows:  facility options + a bottom link
 *                     "Or pick specific blocks first →"
 *     Facility pick → opens the full tab's report.
 *     Pick-blocks    → closes popover, enters selection mode.
 *
 *   Stage 2 (selection mode — checkboxes visible on cards)
 *     Button label:   "🖨 Print 3 Selected ▼"  (disabled if 0 selected)
 *     Sibling "✕ Cancel" button hides the checkboxes and exits.
 *     Popover shows:  facility options only (the user already chose
 *                     which blocks, now they pick where to print).
 */

import { useEffect, useRef, useState } from "react";
import { useSelection } from "./selection-context";

type Facility = "mtcpl" | "riico" | "both";
export type CuttingTab = "pending" | "waiting" | "in_progress" | "done";

const TAB_LABELS: Record<CuttingTab, string> = {
  pending: "Pending Approval",
  waiting: "Waiting to Cut",
  in_progress: "In Progress",
  done: "Done today",
};

export function PrintReportButton({ tab }: { tab: CuttingTab }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { selected, selectionMode, startSelection, cancelSelection } = useSelection();
  const hasSelection = selected.size > 0;
  const isDisabled = selectionMode && !hasSelection;

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
    if (selectionMode && hasSelection) {
      params.set("blocks", Array.from(selected).join(","));
    }
    window.open(
      `/cutting/list-print?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
    // If we just printed a selection, exit selection mode — keeping
    // stale checkboxes around after print is just clutter.
    if (selectionMode) cancelSelection();
  }

  function handleStartSelection() {
    setOpen(false);
    startSelection();
  }

  function handleCancelSelection() {
    cancelSelection();
    setOpen(false);
  }

  const activeLabel = TAB_LABELS[tab];

  // Button text depends on which stage we're in.
  const buttonLabel = selectionMode
    ? `Print ${selected.size} Selected`
    : `Print ${activeLabel}`;

  // Popover footer wording
  const scopeDescription = selectionMode
    ? (<><strong style={{ color: "var(--text)" }}>{selected.size}</strong> selected block{selected.size !== 1 ? "s" : ""}</>)
    : (<>all <strong style={{ color: "var(--text)" }}>{activeLabel}</strong> blocks</>);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {selectionMode && (
        <button
          type="button"
          onClick={handleCancelSelection}
          title="Exit selection mode"
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
          ✕ Cancel
        </button>
      )}

      <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
        <button
          type="button"
          onClick={() => { if (!isDisabled) setOpen(v => !v); }}
          disabled={isDisabled}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 16px",
            background: isDisabled ? "var(--surface)" : "var(--gold)",
            color: isDisabled ? "var(--muted)" : "#fff",
            border: `1px solid ${isDisabled ? "var(--border)" : "var(--gold-dark)"}`,
            borderRadius: 6,
            cursor: isDisabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: isDisabled ? 0.7 : 1,
          }}
          title={
            isDisabled
              ? "Tick at least one card first"
              : selectionMode
                ? `Print a report of the ${selected.size} selected block${selected.size !== 1 ? "s" : ""}`
                : `Print a report of all ${activeLabel.toLowerCase()} blocks`
          }
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={isDisabled}
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
              minWidth: 270,
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

            {/* The "pick specific blocks" entry appears only in stage 1 —
                once the user is already in selection mode, there's no
                reason to offer it again. */}
            {!selectionMode && (
              <>
                <div style={{
                  borderTop: "1px solid var(--border)",
                  margin: "4px 0 2px",
                }} />
                <PickItem
                  label="Or pick specific blocks first →"
                  hint="Show checkboxes on cards, then print only the ticked ones"
                  onClick={handleStartSelection}
                  accent
                />
              </>
            )}

            <div style={{
              fontSize: 10,
              color: "var(--muted)",
              padding: "6px 10px 4px",
              borderTop: "1px solid var(--border)",
              marginTop: 2,
              lineHeight: 1.5,
            }}>
              Includes: {scopeDescription}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PickItem({
  label, hint, onClick, accent = false,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  accent?: boolean;
}) {
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
        color: accent ? "var(--gold-dark)" : "var(--text)",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ fontSize: 13, fontWeight: accent ? 700 : 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{hint}</div>
    </button>
  );
}
