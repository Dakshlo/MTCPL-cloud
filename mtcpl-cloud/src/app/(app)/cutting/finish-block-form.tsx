"use client";

import { useState } from "react";
import { ALLOWED_YARDS, yardLabel } from "@/lib/yards";
import { ExtraSizePicker } from "./extra-size-picker";

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
};

type OpenSlab = {
  id: string;
  label?: string | null;
  temple?: string | null;
  stone?: string | null;
  quality?: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
};

type TransferableSlab = OpenSlab & {
  donor_session_block_id: string;
  donor_block_id: string;
  donor_status: string; // "pending_worker" | "pending_cut" | "cutting"
};

type RemainderEntry = { l: string; w: string; h: string; quality: "" | "A" | "B"; yard: number };

export function FinishBlockForm({
  sessionBlockId,
  sessionId,
  blockId,
  stone,
  yard,
  allSlabs,
  openSlabs = [],
  transferableSlabs = [],
  allowTransfer = false,
  parentQuality = "",
  finishAction,
}: {
  sessionBlockId: string;
  sessionId: string;
  blockId: string;
  stone: string;
  yard: number;
  allSlabs: PlacedSlab[];
  openSlabs?: OpenSlab[];
  /** Slabs currently planned on OTHER cutting blocks. Operator can claim
   *  these ("I cut this slab from THIS block, not the planned one"). */
  transferableSlabs?: TransferableSlab[];
  /** Permission flag — comes from canTransferPlannedSlabs(profile).
   *  When false, the transferable section is hidden entirely. */
  allowTransfer?: boolean;
  /** Parent block's grade. Pre-fills new remainder rows so the operator
   *  doesn't have to re-pick the same grade four times. They can still
   *  override per-row if the interior is a different grade. */
  parentQuality?: "" | "A" | "B";
  finishAction: (formData: FormData) => Promise<void>;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(allSlabs.map((s) => s.id))
  );
  const [remainders, setRemainders] = useState<RemainderEntry[]>([]);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  // Selected transfer slabs — kept separate from extraIds because the
  // server action splits open vs planned via two different formData
  // fields. The combined ExtraSizePicker shows them merged but
  // toggle handlers still route to the right set so submission is
  // unchanged downstream.
  const [transferIds, setTransferIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExtra(id: string) {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTransfer(id: string) {
    setTransferIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addRemainder() {
    // Default each new row to the parent block's grade and yard
    // so the operator only changes them when the interior reveals
    // a different grade, or the leftover piece is being moved to
    // a different yard. Saves clicks on the typical case where
    // everything matches the parent.
    setRemainders((prev) => [...prev, { l: "", w: "", h: "", quality: parentQuality, yard }]);
  }

  function removeRemainder(index: number) {
    setRemainders((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRemainder(index: number, field: "l" | "w" | "h", value: string) {
    setRemainders((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function updateRemainderQuality(index: number, value: "" | "A" | "B") {
    setRemainders((prev) =>
      prev.map((r, i) => (i === index ? { ...r, quality: value } : r))
    );
  }

  function updateRemainderYard(index: number, value: number) {
    setRemainders((prev) =>
      prev.map((r, i) => (i === index ? { ...r, yard: value } : r))
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
    // Quality on the remainder piece — operator can override the
    // parent block's grade when the inside of the block turned out
    // to be a different grade than the surface (e.g. parent was A
    // but the interior cut surface is B). Empty string = unset
    // (server treats as "Both" / null).
    quality: r.quality,
    // Yard override per piece. Defaults to the parent block's
    // yard but the operator can move a leftover piece to a
    // different yard at restock time.
    yard: r.yard,
  })).filter((r) => r.l > 0 && r.w > 0 && r.h > 0);

  const remaindersJson = JSON.stringify(validRemainders);
  const extraSlabIdsList = [...extraIds];
  const transferIdsList = [...transferIds];

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
      <input type="hidden" name="extra_slab_ids" value={JSON.stringify(extraSlabIdsList)} />
      <input type="hidden" name="transferred_slab_ids" value={JSON.stringify(transferIdsList)} />
    </>
  );

  // If any selected transfer-slab is from a 'cutting' donor (operator
  // is actively cutting that block right now), require explicit
  // confirmation before submitting. Less risky donor states (pending)
  // submit silently.
  function confirmIfCuttingDonors(e: React.FormEvent) {
    const selectedFromCutting = transferableSlabs.filter(
      (s) => transferIds.has(s.id) && s.donor_status === "cutting",
    );
    if (selectedFromCutting.length > 0) {
      const list = selectedFromCutting
        .map((s) => `  · ${s.id} (from ${s.donor_block_id})`)
        .join("\n");
      const ok = confirm(
        `⚠ ${selectedFromCutting.length} slab(s) you're claiming are from blocks that are CURRENTLY BEING CUT:\n\n${list}\n\nClaiming will modify their plans and require a reprint. Continue?`,
      );
      if (!ok) e.preventDefault();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
      {/* Slab checklist — bilingual header for floor staff */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
            ✂️ Kati hui slabs
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Mark slabs that were actually cut · <strong>{cutCount}/{totalCount}</strong>
          </div>
        </div>
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
                {slab.sw}×{slab.sh} in
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

      {/* Combined picker — Open inventory + Claim-from-another-block
          merged into one center-peek modal. Replaces the previous
          two inline sections so the Done button stays above the
          fold and operators don't have to search the same slab id
          in two places. The picker handles search (id / temple /
          label / size / donor block), selected-on-top sorting, and
          status badges for planned rows. Submission split is still
          done internally via extraIds vs transferIds. */}
      {(openSlabs.length > 0 || (allowTransfer && transferableSlabs.length > 0)) && (
        <ExtraSizePicker
          openSlabs={openSlabs}
          transferableSlabs={transferableSlabs}
          allowTransfer={allowTransfer}
          selectedExtraIds={extraIds}
          selectedTransferIds={transferIds}
          onToggleExtra={toggleExtra}
          onToggleTransfer={toggleTransfer}
        />
      )}

      {/* Remaining block pieces — bilingual header + per-row Grade
          selector. Operator can override the parent block's grade
          when the inside of the block turned out to be a different
          quality than the outside. */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: remainders.length ? 10 : 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
              ♻️ बचा हुआ block / निकले हुए block
              {remainders.length > 0 && (
                <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: 8, verticalAlign: "middle" }}>
                  {validRemainders.length} valid
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              अगर block का कोई हिस्सा बच गया हो तो नीचे लिखें — कुछ नहीं बचा तो खाली छोड़ दें
            </div>
          </div>
          <button
            type="button"
            className="ghost-button"
            style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
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
                placeholder="L in"
                value={r.l}
                onChange={(e) => updateRemainder(i, "l", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="W in"
                value={r.w}
                onChange={(e) => updateRemainder(i, "w", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="H in"
                value={r.h}
                onChange={(e) => updateRemainder(i, "h", e.target.value)}
                style={{ width: 72, fontSize: 13 }}
              />
              <span className="muted" style={{ fontSize: 11 }}>in</span>
              {/* Per-piece grade override. Default empty = "Both"
                  in inventory. Operator picks A or B if the cut
                  surface tells them the interior grade differs. */}
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>Grade</span>
              <select
                value={r.quality}
                onChange={(e) => updateRemainderQuality(i, e.target.value as "" | "A" | "B")}
                style={{ fontSize: 13, padding: "3px 6px" }}
                title="Grade of this remainder piece — override if the inside of the block is a different grade than the outside"
              >
                <option value="">Both</option>
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
              {/* Per-piece yard override. Defaults to the parent
                  block's yard. Operator may relocate a leftover
                  piece (e.g. the saw moved across yards mid-cut). */}
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>Yard</span>
              <select
                value={r.yard}
                onChange={(e) => updateRemainderYard(i, Number(e.target.value))}
                style={{ fontSize: 13, padding: "3px 6px" }}
                title="Yard of this remainder piece — override if the leftover is being moved to a different yard"
              >
                {ALLOWED_YARDS.map((y) => (
                  <option key={y} value={y}>
                    {yardLabel(y)}
                  </option>
                ))}
              </select>
              {isValid && (
                <span className="role-pill badge-available" style={{ fontSize: 10 }}>
                  {stone}
                  {r.quality ? ` · Grade ${r.quality}` : ""}
                  {r.yard !== yard ? ` · ${yardLabel(r.yard)}` : ""}
                  {" · Reused"}
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
            <form action={finishAction} onSubmit={confirmIfCuttingDonors}>
              {hiddenInputs("yes")}
              <button className="primary-button" type="submit">
                Done &amp; Restock ({validRemainders.length} piece{validRemainders.length > 1 ? "s" : ""})
              </button>
            </form>
            <form action={finishAction} onSubmit={confirmIfCuttingDonors}>
              {hiddenInputs("no")}
              <button className="secondary-button" type="submit">Done &amp; Discard</button>
            </form>
          </>
        ) : (
          <form action={finishAction} onSubmit={confirmIfCuttingDonors}>
            {hiddenInputs("no")}
            <button className="primary-button" type="submit">Done</button>
          </form>
        )}
      </div>
    </div>
  );
}
