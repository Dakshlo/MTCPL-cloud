"use client";

import { useState } from "react";

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

type RemainderEntry = { l: string; w: string; h: string; quality: "" | "A" | "B" };

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
  finishAction: (formData: FormData) => Promise<void>;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(allSlabs.map((s) => s.id))
  );
  const [remainders, setRemainders] = useState<RemainderEntry[]>([]);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [extraFilter, setExtraFilter] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  // Selected transfer slabs — kept separate from extraIds because the
  // server action splits open vs planned via two different formData fields.
  const [transferIds, setTransferIds] = useState<Set<string>>(new Set());
  // The transferable-slabs panel is a sharp tool (donor blocks get their
  // plans modified + a reprint banner). Default-collapse it so the long
  // list doesn't dominate the form when the operator just wants to mark
  // their planned slabs cut. Auto-stays-open if the operator has already
  // selected something to transfer (so they don't lose visibility on a
  // selection mid-edit).
  const [showTransfer, setShowTransfer] = useState(false);

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
    setRemainders((prev) => [...prev, { l: "", w: "", h: "", quality: "" }]);
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

  const filteredOpenSlabs = openSlabs.filter((s) => {
    if (!extraFilter) return true;
    const q = extraFilter.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      (s.temple ?? "").toLowerCase().includes(q) ||
      (s.label ?? "").toLowerCase().includes(q)
    );
  });
  const filteredTransferableSlabs = transferableSlabs.filter((s) => {
    if (!extraFilter) return true;
    const q = extraFilter.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      (s.temple ?? "").toLowerCase().includes(q) ||
      (s.label ?? "").toLowerCase().includes(q) ||
      s.donor_block_id.toLowerCase().includes(q)
    );
  });

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

      {/* Unplanned slabs (deviation picker) — bilingual header */}
      {openSlabs.length > 0 && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: showExtra ? 10 : 0 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
                ➕ Extra kata hua size
                {extraIds.size > 0 && (
                  <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: 8, verticalAlign: "middle" }}>
                    {extraIds.size} selected
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Also cut from this block (unplanned) — pick from open inventory
              </div>
            </div>
            <button
              type="button"
              className="ghost-button"
              style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
              onClick={() => setShowExtra((v) => !v)}
            >
              {showExtra ? "− Hide" : "+ Add unplanned slab"}
            </button>
          </div>

          {showExtra && (
            <>
              <input
                type="text"
                placeholder="Filter by ID, temple, label…"
                value={extraFilter}
                onChange={(e) => setExtraFilter(e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 13,
                  marginBottom: 8,
                  boxSizing: "border-box",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "6px 10px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  outline: "none",
                }}
              />
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {filteredOpenSlabs.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No matching slabs found.</p>
                ) : (
                  filteredOpenSlabs.map((slab) => (
                    <label
                      key={slab.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={extraIds.has(slab.id)}
                        onChange={() => toggleExtra(slab.id)}
                        style={{ width: 15, height: 15, cursor: "pointer" }}
                      />
                      <code style={{ fontSize: 12, fontWeight: 600 }}>{slab.id}</code>
                      {slab.temple && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {slab.temple}{slab.label && slab.label !== slab.temple ? ` · ${slab.label}` : ""}
                        </span>
                      )}
                      <span className="muted" style={{ fontSize: 11 }}>
                        {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft} in
                      </span>
                      {extraIds.has(slab.id) && (
                        <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: "auto" }}>
                          Added ✓
                        </span>
                      )}
                    </label>
                  ))
                )}
              </div>
              {extraIds.size > 0 && (
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  {extraIds.size} unplanned slab{extraIds.size > 1 ? "s" : ""} will be marked as cut from this block.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Transferable planned slabs — claim from another block's plan.
       *  Only visible to permitted users (canTransferPlannedSlabs check).
       *  Sharp tool: the donor block's plan gets edited and operators
       *  there see a "needs reprint" banner. Confirm dialog fires on
       *  submit if any selected slab's donor is currently 'cutting'. */}
      {allowTransfer && transferableSlabs.length > 0 && (() => {
        // Auto-expand whenever the operator has at least one transfer
        // selected, so a fresh re-render (e.g. after toggling a checkbox)
        // can't accidentally hide their selection.
        const isOpen = showTransfer || transferIds.size > 0;
        return (
        <div
          style={{
            background: "rgba(180,83,9,0.04)",
            border: "1px solid rgba(180,83,9,0.25)",
            borderLeft: "3px solid #b45309",
            borderRadius: 8,
            padding: "10px 14px",
          }}
        >
          <button
            type="button"
            onClick={() => setShowTransfer((v) => !v)}
            aria-expanded={isOpen}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
              width: "100%",
              padding: 0,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{isOpen ? "▾" : "▸"}</span>
                ⚠ Claim from another block&rsquo;s plan
                <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
                  ({transferableSlabs.length} available)
                </span>
                {transferIds.size > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      background: "#b45309",
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {transferIds.size} selected
                  </span>
                )}
              </p>
              {isOpen && (
                <p className="muted" style={{ fontSize: 11, margin: "3px 0 0", lineHeight: 1.5 }}>
                  Use only if you cut a slab from THIS block that was originally
                  planned for another block. The donor block&rsquo;s plan will be
                  modified and they&rsquo;ll be asked to reprint.
                </p>
              )}
            </div>
          </button>

          {isOpen && (<>
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              border: "1px solid var(--border-light)",
              borderRadius: 6,
              padding: 6,
              background: "var(--surface)",
              marginTop: 8,
            }}
          >
            {filteredTransferableSlabs.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, padding: 8, margin: 0 }}>
                {extraFilter ? "No matching planned slabs." : "No planned slabs available to claim."}
              </p>
            ) : (
              filteredTransferableSlabs.map((slab) => {
                const checked = transferIds.has(slab.id);
                const donorPill =
                  slab.donor_status === "cutting"
                    ? { label: "🚨 CUTTING NOW", color: "#b91c1c", bg: "rgba(220,38,38,0.1)", border: "rgba(220,38,38,0.4)" }
                    : slab.donor_status === "pending_cut"
                      ? { label: "⏱ WAITING TO CUT", color: "#b45309", bg: "rgba(180,83,9,0.1)", border: "rgba(180,83,9,0.4)" }
                      : { label: "📋 PENDING APPROVAL", color: "#7c3aed", bg: "rgba(124,58,237,0.1)", border: "rgba(124,58,237,0.4)" };
                return (
                  <label
                    key={slab.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "6px 8px",
                      background: checked ? "rgba(180,83,9,0.08)" : "transparent",
                      borderRadius: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTransfer(slab.id)}
                      style={{ width: 15, height: 15, cursor: "pointer" }}
                    />
                    <code style={{ fontSize: 12, fontWeight: 700 }}>{slab.id}</code>
                    {slab.temple && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {slab.temple}
                        {slab.label && slab.label !== slab.temple ? ` · ${slab.label}` : ""}
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                      {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft} in
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="muted" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
                        from {slab.donor_block_id}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: donorPill.color,
                          background: donorPill.bg,
                          border: `1px solid ${donorPill.border}`,
                          padding: "1px 6px",
                          borderRadius: 3,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {donorPill.label}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {transferIds.size > 0 && (
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              {transferIds.size} planned slab{transferIds.size > 1 ? "s" : ""} will be transferred to this block.
              Donor blocks will be marked &ldquo;needs reprint&rdquo;.
            </p>
          )}
          </>)}
        </div>
        );
      })()}

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
              Remaining block pieces — leave blank if none / discarded
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
              {isValid && (
                <span className="role-pill badge-available" style={{ fontSize: 10 }}>
                  {stone}{r.quality ? ` · Grade ${r.quality}` : ""} · Reused
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
