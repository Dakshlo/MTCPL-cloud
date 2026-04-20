"use client";

/**
 * Inline checkbox that toggles this block's membership in the print
 * selection. Subtle at rest — gold-tinted when checked — so it doesn't
 * visually shout on cards the user isn't actively picking.
 *
 * Clicking the checkbox stops propagation so it doesn't interfere with
 * any card-level click handlers (none today, but future-proof).
 */

import { useSelection } from "./selection-context";

export function BlockSelector({ id }: { id: string }) {
  const { selected, toggle } = useSelection();
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
          width: 17,
          height: 17,
          cursor: "pointer",
          accentColor: "#b87333",
          margin: 0,
        }}
      />
    </label>
  );
}
