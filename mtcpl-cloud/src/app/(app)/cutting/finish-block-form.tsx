"use client";

import { useState } from "react";

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
};

type RemainderEntry = { l: string; w: string; h: string };

export function FinishBlockForm({
  sessionBlockId,
  sessionId,
  blockId,
  stone,
  yard,
  allSlabs,
  finishAction,
}: {
  sessionBlockId: string;
  sessionId: string;
  blockId: string;
  stone: string;
  yard: number;
  allSlabs: PlacedSlab[];
  finishAction: (formData: FormData) => Promise<void>;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(allSlabs.map((s) => s.id))
  );
  const [remainders, setRemainders] = useState<RemainderEntry[]>([]);

  function toggle(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addRemainder() {
    setRemainders((prev) => [...prev, { l: "", w: "", h: "" }]);
  }

  function removeRemainder(index: number) {
    setRemainders((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRemainder(index: number, field: "l" | "w" | "h", value: string) {
    setRemainders((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  const cutSlabIds = allSlabs.filter((s) => checkedIds.has(s.id)).map((s) => s.id);
  const cutCount = cutSlabIds.length;
  const totalCount = allSlabs.length;

  // Only include entries that have at least one non-zero dimension entered
  const validRemainders = remainders.map((r, i) => ({
    id: `${blockId}-${i + 1}`,
    l: parseFloat(r.l) || 0,
    w: parseFloat(r.w) || 0,
    h: parseFloat(r.h) || 0,
  })).filter((r) => r.l > 0 && r.w > 0 && r.h > 0);

  const remaindersJson = JSON.stringify(validRemainders);

  const hiddenInputs = (restock: "yes" | "no") => (
    <>
      <input type="hidden" name="session_block_id" value={sessionBlockId} />
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="stone" value={stone} />
      <input type="hidden" name="yard" value={String(yard)} />
      <input type="hidden" name="cut_slab_ids" value={JSON.stringify(cutSlabIds)} />
      <input type="hidden" name="all_slab_ids" value={JSON.stringify(allSlabs.map((s) => s.id))} />
      <input type="hidden" name="remainders_json" value={remaindersJson} />
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

      {/* Remaining block pieces */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: remainders.length ? 10 : 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: "var(--text)" }}>
            Remaining block pieces{remainders.length > 0 ? ` (${validRemainders.length} valid)` : ""}
          </p>
          <button
            type="button"
            className="ghost-button"
            style={{ fontSize: 12, padding: "2px 10px" }}
            onClick={addRemainder}
          >
            + Add piece
          </button>
        </div>

        {remainders.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            No remaining pieces — click &ldquo;+ Add piece&rdquo; for each leftover block.
          </p>
        )}

        {remainders.map((r, i) => {
          const pieceId = `${blockId}-${i + 1}`;
          const isValid = parseFloat(r.l) > 0 && parseFloat(r.w) > 0 && parseFloat(r.h) > 0;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
                padding: "8px 10px",
                background: "var(--surface)",
                border: `1px solid ${isValid ? "var(--border)" : "var(--border-light)"}`,
                borderRadius: 6,
              }}
            >
              <code style={{ fontSize: 12, fontWeight: 700, minWidth: 80, color: "var(--accent)" }}>
                {pieceId}
              </code>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="L ft"
                value={r.l}
                onChange={(e) => updateRemainder(i, "l", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="W ft"
                value={r.w}
                onChange={(e) => updateRemainder(i, "w", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="H ft"
                value={r.h}
                onChange={(e) => updateRemainder(i, "h", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>ft</span>
              {isValid && (
                <span className="role-pill badge-available" style={{ fontSize: 10 }}>
                  {stone} · Reused
                </span>
              )}
              <button
                type="button"
                className="ghost-button danger-ghost"
                style={{ fontSize: 12, padding: "1px 8px", marginLeft: "auto" }}
                onClick={() => removeRemainder(i)}
              >
                ×
              </button>
            </div>
          );
        })}

        {validRemainders.length > 0 && (
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {validRemainders.length} piece{validRemainders.length > 1 ? "s" : ""} will be added to Blocks inventory when you click &ldquo;Done &amp; Restock&rdquo;.
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {validRemainders.length > 0 ? (
          <>
            <form action={finishAction}>
              {hiddenInputs("yes")}
              <button className="primary-button" type="submit">
                Done &amp; Restock ({validRemainders.length} piece{validRemainders.length > 1 ? "s" : ""})
              </button>
            </form>
            <form action={finishAction}>
              {hiddenInputs("no")}
              <button className="secondary-button" type="submit">Done &amp; Discard</button>
            </form>
          </>
        ) : (
          <form action={finishAction}>
            {hiddenInputs("no")}
            <button className="primary-button" type="submit">Done</button>
          </form>
        )}
      </div>
    </div>
  );
}
