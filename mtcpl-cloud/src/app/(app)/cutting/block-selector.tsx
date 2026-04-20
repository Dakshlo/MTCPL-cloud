"use client";

/**
 * Per-card checkbox for picking blocks to print. Renders nothing until
 * the user enables selection mode from the Print popover — the cards
 * stay clean during normal work.
 */

import { useSelection } from "./selection-context";

export function BlockSelector({ id }: { id: string }) {
  const { selected, selectionMode, toggle } = useSelection();

  if (!selectionMode) return null;

  const isChecked = selected.has(id);

  return (
    <label
      title={isChecked ? "Remove from print selection" : "Add to print selection"}
      onClick={e => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
        padding: 4,
        marginRight: 2,
        flexShrink: 0,
      }}
    >
      <input
        type="checkbox"
        checked={isChecked}
        onChange={() => toggle(id)}
        style={{
          width: 18,
          height: 18,
          cursor: "pointer",
          accentColor: "#b87333",
          margin: 0,
        }}
      />
    </label>
  );
}
