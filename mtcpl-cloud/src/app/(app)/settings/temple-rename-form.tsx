"use client";

// Mig 161 — rename a temple's NAME (owner/dev). The rename_temple() function
// cascades the change to every table that copies the name, so it's safe; a
// confirm spells that out. The code prefix stays locked (slab IDs embed it).

import { useState } from "react";
import { renameTempleAction } from "./actions";

export function TempleRenameForm({ templeId, currentName }: { templeId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setName(currentName); setOpen(true); }}
        style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        ✏️ Rename temple name
      </button>
    );
  }

  return (
    <form
      action={renameTempleAction}
      onSubmit={(e) => {
        const next = name.trim();
        if (!next || next === currentName) { e.preventDefault(); setOpen(false); return; }
        if (!confirm(`Rename "${currentName}" → "${next}"?\n\nThis updates the name on every slab, dispatch, challan, image and work order for this temple (the code prefix stays the same).`)) {
          e.preventDefault();
        }
      }}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", border: "1px solid var(--gold-dark)", borderRadius: 10, background: "rgba(184,115,51,0.05)", marginBottom: 10 }}
    >
      <input type="hidden" name="id" value={templeId} />
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>✏️ New name</span>
      <input
        name="new_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        autoFocus
        style={{ flex: "1 1 240px", padding: "8px 10px", fontSize: 13.5, border: "1px solid var(--border)", borderRadius: 8 }}
      />
      <button type="submit" className="primary-button" style={{ fontSize: 13 }}>Rename everywhere</button>
      <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
