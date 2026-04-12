"use client";

import { useState } from "react";

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
};

export function FinishBlockForm({
  sessionBlockId,
  sessionId,
  blockId,
  stone,
  yard,
  allSlabs,
  largestRemainder,
  finishAction,
}: {
  sessionBlockId: string;
  sessionId: string;
  blockId: string;
  stone: string;
  yard: number;
  allSlabs: PlacedSlab[];
  largestRemainder: { l: number; w: number; h: number } | null;
  finishAction: (formData: FormData) => Promise<void>;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(allSlabs.map((s) => s.id))
  );

  function toggle(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const cutSlabIds = allSlabs.filter((s) => checkedIds.has(s.id)).map((s) => s.id);
  const cutCount = cutSlabIds.length;
  const totalCount = allSlabs.length;

  const hiddenInputs = (restock: "yes" | "no") => (
    <>
      <input type="hidden" name="session_block_id" value={sessionBlockId} />
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="stone" value={stone} />
      <input type="hidden" name="yard" value={String(yard)} />
      <input type="hidden" name="cut_slab_ids" value={JSON.stringify(cutSlabIds)} />
      <input type="hidden" name="all_slab_ids" value={JSON.stringify(allSlabs.map((s) => s.id))} />
      <input type="hidden" name="largest_remainder" value={JSON.stringify(largestRemainder)} />
      <input type="hidden" name="restock" value={restock} />
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
      {/* Slab checklist */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
        <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 10px", color: "var(--text)" }}>
          Mark slabs that were actually cut ({cutCount}/{totalCount})
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {allSlabs.map((slab) => (
            <label
              key={slab.id}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={checkedIds.has(slab.id)}
                onChange={() => toggle(slab.id)}
                style={{ width: 15, height: 15, cursor: "pointer" }}
              />
              <code style={{ fontSize: 12, fontWeight: 600 }}>{slab.id}</code>
              {slab.temple && (
                <span className="muted" style={{ fontSize: 11 }}>
                  {slab.temple}{slab.label && slab.label !== slab.temple ? ` · ${slab.label}` : ""}
                </span>
              )}
              <span className="muted" style={{ fontSize: 11 }}>
                {slab.sw}×{slab.sh} ft
              </span>
              <span
                className={`role-pill ${checkedIds.has(slab.id) ? "badge-available" : "badge-discarded"}`}
                style={{ fontSize: 10, marginLeft: "auto" }}
              >
                {checkedIds.has(slab.id) ? "Cut ✓" : "Not cut"}
              </span>
            </label>
          ))}
        </div>
        {cutCount < totalCount && (
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            {totalCount - cutCount} unchecked slab{totalCount - cutCount > 1 ? "s" : ""} will go back to Open in inventory.
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <form action={finishAction}>{hiddenInputs("yes")}<button className="primary-button" type="submit">Done &amp; Restock Remainder</button></form>
        <form action={finishAction}>{hiddenInputs("no")}<button className="secondary-button" type="submit">Done &amp; Discard Remainder</button></form>
      </div>
    </div>
  );
}
