"use client";

/**
 * Combined picker for "extra size cutting" on the Cutting Done
 * form. Replaces the old two-section layout (one for Open
 * inventory + one for Claim-from-another-block's-plan) with a
 * single center-peek modal.
 *
 * Why combined:
 *   • Operators were searching the same slab id in two places to
 *     figure out where it lived.
 *   • The two-section layout doubled the page length and pushed
 *     the Done button below the fold on small screens.
 *
 * What's in the modal:
 *   • Single search box that matches id / temple / label / size
 *     ("38x34" matches "38×34", spaces tolerated).
 *   • Selected slabs pinned to the top (in selection order) so
 *     they stay visible while the operator scrolls a long list.
 *   • Open-inventory rows render in neutral chrome.
 *   • Already-planned-on-another-block rows render in red-tinted
 *     chrome with a status badge:
 *       pending_worker → PENDING APPROVAL  (grey)
 *       pending_cut    → WAITING TO CUT    (amber)
 *       cutting        → CUTTING NOW       (red — most urgent;
 *                                           claiming modifies a
 *                                           live plan + triggers
 *                                           a reprint)
 *   • Donor block id is shown next to each planned row so the
 *     operator can tell which other block they're stealing from.
 *
 * Selection state stays split internally between
 *   selectedExtraIds (open inventory)         → extra_slab_ids form field
 *   selectedTransferIds (planned/transfer)    → transferred_slab_ids field
 * because the server action handles the two paths differently
 * (extras just flip status; transfers strip the donor's plan).
 * The user just sees one merged list.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { matchesDimSearch } from "@/lib/dimension-search";

export type OpenSlabItem = {
  id: string;
  label?: string | null;
  temple?: string | null;
  stone?: string | null;
  quality?: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
};

export type TransferableSlabItem = OpenSlabItem & {
  donor_session_block_id: string;
  donor_block_id: string;
  /** "pending_worker" | "pending_cut" | "cutting" */
  donor_status: string;
};

type CombinedItem =
  | (OpenSlabItem & { kind: "open" })
  | (TransferableSlabItem & { kind: "planned" });

function donorStatusBadge(status: string): { label: string; bg: string; fg: string; border: string } {
  if (status === "cutting") {
    return {
      label: "CUTTING NOW",
      bg: "rgba(220,38,38,0.18)",
      fg: "#b91c1c",
      border: "rgba(220,38,38,0.45)",
    };
  }
  if (status === "pending_cut") {
    return {
      label: "WAITING TO CUT",
      bg: "rgba(180,83,9,0.18)",
      fg: "#b45309",
      border: "rgba(180,83,9,0.45)",
    };
  }
  // pending_worker (or any other unexpected status)
  return {
    label: "PENDING APPROVAL",
    bg: "rgba(100,116,139,0.18)",
    fg: "#475569",
    border: "rgba(100,116,139,0.40)",
  };
}

export function ExtraSizePicker({
  openSlabs,
  transferableSlabs,
  allowTransfer,
  selectedExtraIds,
  selectedTransferIds,
  onToggleExtra,
  onToggleTransfer,
}: {
  openSlabs: OpenSlabItem[];
  transferableSlabs: TransferableSlabItem[];
  /** When false the planned/claim list is hidden entirely. */
  allowTransfer: boolean;
  selectedExtraIds: Set<string>;
  selectedTransferIds: Set<string>;
  onToggleExtra: (id: string) => void;
  onToggleTransfer: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Track selection insertion order so the pinned-on-top rows
  // stay in the order the operator picked them — easier to spot
  // the most recent click.
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  useEffect(() => {
    setSelectionOrder((prev) => {
      const all = new Set([...selectedExtraIds, ...selectedTransferIds]);
      const kept = prev.filter((id) => all.has(id));
      for (const id of all) if (!kept.includes(id)) kept.push(id);
      return kept;
    });
  }, [selectedExtraIds, selectedTransferIds]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Combine the two pools into one tagged list.
  const items: CombinedItem[] = useMemo(() => {
    const out: CombinedItem[] = openSlabs.map((s) => ({ ...s, kind: "open" }));
    if (allowTransfer) {
      for (const s of transferableSlabs) {
        out.push({ ...s, kind: "planned" });
      }
    }
    return out;
  }, [openSlabs, transferableSlabs, allowTransfer]);

  // Filter by search term — id / temple / label / dimensions /
  // donor block id (for planned rows). "38x34" matches "38×34".
  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return items;
    return items.filter((i) => {
      if (i.id.toLowerCase().includes(lower)) return true;
      if ((i.temple ?? "").toLowerCase().includes(lower)) return true;
      if ((i.label ?? "").toLowerCase().includes(lower)) return true;
      // Order-insensitive: 22x50x5 also matches 50x22x5 / 5x22x50 etc.
      if (matchesDimSearch(lower, [i.length_ft, i.width_ft, i.thickness_ft])) return true;
      if (i.kind === "planned" && i.donor_block_id.toLowerCase().includes(lower)) return true;
      return false;
    });
  }, [items, q]);

  // Sort: selected (in selection order) first, then unselected
  // open slabs, then unselected planned slabs.
  const sorted = useMemo(() => {
    const isSelected = (i: CombinedItem) =>
      i.kind === "open"
        ? selectedExtraIds.has(i.id)
        : selectedTransferIds.has(i.id);

    const selectedItems: CombinedItem[] = [];
    const unselectedItems: CombinedItem[] = [];
    for (const i of filtered) {
      if (isSelected(i)) selectedItems.push(i);
      else unselectedItems.push(i);
    }
    // Preserve selection-order for the pinned section.
    const orderIndex = new Map(selectionOrder.map((id, idx) => [id, idx]));
    selectedItems.sort(
      (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
    );
    // Open inventory before planned in the unselected section so
    // the safer choice surfaces first.
    unselectedItems.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "open" ? -1 : 1;
      return 0;
    });
    return [...selectedItems, ...unselectedItems];
  }, [filtered, selectedExtraIds, selectedTransferIds, selectionOrder]);

  const totalSelected = selectedExtraIds.size + selectedTransferIds.size;
  const openCount = openSlabs.length;
  const plannedCount = allowTransfer ? transferableSlabs.length : 0;

  function toggle(item: CombinedItem) {
    if (item.kind === "open") onToggleExtra(item.id);
    else onToggleTransfer(item.id);
  }

  return (
    <>
      {/* Trigger card */}
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "12px 14px",
          cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-alt)";
          e.currentTarget.style.borderColor = "var(--gold-dark)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--bg)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
            ➕ Extra size cutting
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginLeft: 8 }}>
              (planned + live cutting)
            </span>
            {totalSelected > 0 && (
              <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: 8, verticalAlign: "middle" }}>
                {totalSelected} selected
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            जो slabs plan में नहीं थीं पर इस block से extra काटी गयीं — open inventory + दूसरे blocks के planned slabs एक साथ
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            {openCount} open
            {allowTransfer ? ` · ${plannedCount} planned` : ""}
          </span>
          <span
            className="role-pill"
            style={{
              background: "var(--gold)",
              color: "#fff",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Open picker →
          </span>
        </div>
      </div>

      {/* Selected slab chips outside the modal so the operator can
          see EXACTLY which slabs will be added without re-opening
          the picker. Open-inventory slabs render in green; planned
          (claimed-from-another-block) slabs render in red with
          their donor block id appended. Click an X on any chip to
          unselect it without re-opening the modal. */}
      {totalSelected > 0 && (() => {
        const openItems = items.filter(
          (i): i is OpenSlabItem & { kind: "open" } =>
            i.kind === "open" && selectedExtraIds.has(i.id),
        );
        const plannedItems = items.filter(
          (i): i is TransferableSlabItem & { kind: "planned" } =>
            i.kind === "planned" && selectedTransferIds.has(i.id),
        );
        // Daksh May 2026 — "orphan" chips for IDs that are selected
        // but no longer in `items` (the picker only loads OPEN
        // inventory, so a slab that's since been cut_done by another
        // block disappears from the list while its id stays in the
        // selection set). Without a chip the operator can't see what
        // they selected and can't click × to remove it — exactly the
        // trap MT-B-257 hit. Render orphans as red "needs removing"
        // chips so they're impossible to miss.
        const openItemIds = new Set(
          items.filter((i) => i.kind === "open").map((i) => i.id),
        );
        const plannedItemIds = new Set(
          items.filter((i) => i.kind === "planned").map((i) => i.id),
        );
        const orphanExtraIds: string[] = [];
        for (const id of selectedExtraIds) {
          if (!openItemIds.has(id)) orphanExtraIds.push(id);
        }
        const orphanTransferIds: string[] = [];
        for (const id of selectedTransferIds) {
          if (!plannedItemIds.has(id)) orphanTransferIds.push(id);
        }
        return (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: "rgba(22,101,52,0.04)",
              border: "1px solid rgba(22,101,52,0.20)",
              borderRadius: 6,
            }}
          >
            <div className="muted" style={{ fontSize: 11, marginBottom: 6, lineHeight: 1.4 }}>
              <strong style={{ color: "#15803d" }}>{totalSelected}</strong> slab
              {totalSelected === 1 ? "" : "s"} queued — will be cut from this block when you click Done:
              {selectedExtraIds.size > 0 && (
                <> <strong style={{ color: "#15803d" }}>{selectedExtraIds.size}</strong> from open inventory</>
              )}
              {selectedExtraIds.size > 0 && selectedTransferIds.size > 0 && " · "}
              {selectedTransferIds.size > 0 && (
                <>
                  {" "}
                  <strong style={{ color: "#b91c1c" }}>{selectedTransferIds.size}</strong> claimed from another block&rsquo;s plan
                </>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {openItems.map((s) => (
                <span
                  key={`open-${s.id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "rgba(22,101,52,0.10)",
                    color: "#15803d",
                    border: "1px solid rgba(22,101,52,0.30)",
                    borderRadius: 4,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                >
                  {s.id}
                  <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                    {s.length_ft}×{s.width_ft}″
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleExtra(s.id)}
                    title="Remove"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#15803d",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 13,
                      lineHeight: 1,
                      marginLeft: 2,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {plannedItems.map((s) => {
                const badge = donorStatusBadge(s.donor_status);
                return (
                  <span
                    key={`planned-${s.id}`}
                    title={`From ${s.donor_block_id} · ${badge.label}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "rgba(220,38,38,0.08)",
                      color: "#b91c1c",
                      border: "1px solid rgba(220,38,38,0.35)",
                      borderRadius: 4,
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                    }}
                  >
                    {s.id}
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                      {s.length_ft}×{s.width_ft}″
                    </span>
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                      ← {s.donor_block_id}
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleTransfer(s.id)}
                      title="Remove"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#b91c1c",
                        cursor: "pointer",
                        padding: 0,
                        fontSize: 13,
                        lineHeight: 1,
                        marginLeft: 2,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {/* Daksh May 2026 — orphan chips. ID is in the selection
                  but the picker doesn't know about it (consumed by
                  another block since the form opened). Click × to
                  drop the stale ID from the selection so the
                  block can be approved. */}
              {orphanExtraIds.map((id) => (
                <span
                  key={`orphan-extra-${id}`}
                  title="This slab is no longer available (already cut by another block). Click × to remove it from the selection."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "rgba(220,38,38,0.10)",
                    color: "#b91c1c",
                    border: "1.5px dashed #b91c1c",
                    borderRadius: 4,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                  }}
                >
                  ⚠ {id}
                  <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                    no longer available
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleExtra(id)}
                    title="Remove this stale slab from the selection"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#b91c1c",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 13,
                      lineHeight: 1,
                      marginLeft: 2,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {orphanTransferIds.map((id) => (
                <span
                  key={`orphan-transfer-${id}`}
                  title="This transferred slab is no longer claimable. Click × to remove it from the selection."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "rgba(220,38,38,0.10)",
                    color: "#b91c1c",
                    border: "1.5px dashed #b91c1c",
                    borderRadius: 4,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                  }}
                >
                  ⚠ {id}
                  <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                    no longer claimable
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleTransfer(id)}
                    title="Remove this stale slab from the selection"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#b91c1c",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 13,
                      lineHeight: 1,
                      marginLeft: 2,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Center-peek modal */}
      {open && (
        <div
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            left: "var(--content-left)",
            right: 0,
            bottom: 0,
            background: "rgba(15, 12, 6, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "6vh",
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
              width: "100%",
              maxWidth: 960,
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17 }}>
                    ➕ Extra size cutting
                    {totalSelected > 0 && (
                      <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: 10, verticalAlign: "middle" }}>
                        {totalSelected} selected
                      </span>
                    )}
                  </h2>
                  <p className="muted" style={{ fontSize: 12, margin: "3px 0 0" }}>
                    Open inventory + planned slabs from other cutting blocks. Selected items pinned to top.
                  </p>
                </div>
                <kbd
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, monospace",
                    whiteSpace: "nowrap",
                  }}
                  title="Close"
                >
                  Esc
                </kbd>
              </div>

              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by id, temple, label, size (e.g. 38x34) or donor block…"
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "8px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface)",
                  color: "var(--text)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                <span>
                  <strong style={{ color: "var(--text)" }}>{openCount}</strong> open inventory
                </span>
                {allowTransfer && (
                  <span>
                    <strong style={{ color: "#b91c1c" }}>{plannedCount}</strong> planned on other blocks (claim with care)
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}>
                  Showing <strong style={{ color: "var(--text)" }}>{sorted.length}</strong>
                </span>
              </div>
            </div>

            {/* Body — scrolling list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {sorted.length === 0 ? (
                <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  {q ? <>No slabs match &ldquo;{q}&rdquo;.</> : "No slabs available."}
                </div>
              ) : (
                <>
                  {/* If we have any selected, show a section header */}
                  {totalSelected > 0 && (
                    <div
                      style={{
                        padding: "8px 18px",
                        background: "rgba(22,101,52,0.08)",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#15803d",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      ✓ {totalSelected} selected · click again to unselect
                    </div>
                  )}
                  {sorted.map((item) => {
                    const isSelected =
                      item.kind === "open"
                        ? selectedExtraIds.has(item.id)
                        : selectedTransferIds.has(item.id);
                    const isPlanned = item.kind === "planned";
                    const badge = isPlanned ? donorStatusBadge(item.donor_status) : null;
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onClick={() => toggle(item)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 18px",
                          background: isSelected
                            ? "rgba(22,101,52,0.08)"
                            : isPlanned
                              ? "rgba(220,38,38,0.04)"
                              : "transparent",
                          border: "none",
                          borderBottom: "1px solid var(--border-light)",
                          borderLeft: isSelected
                            ? "4px solid #15803d"
                            : isPlanned
                              ? "4px solid rgba(220,38,38,0.45)"
                              : "4px solid transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          transition: "background 0.08s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = isPlanned
                              ? "rgba(220,38,38,0.10)"
                              : "var(--surface-alt)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = isPlanned
                              ? "rgba(220,38,38,0.04)"
                              : "transparent";
                          }
                        }}
                      >
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: `2px solid ${isSelected ? "#15803d" : "var(--border)"}`,
                            background: isSelected ? "#15803d" : "transparent",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {isSelected ? "✓" : ""}
                        </span>
                        <span
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 700,
                            fontSize: 13,
                            color: isPlanned ? "#b91c1c" : "var(--gold-dark)",
                            minWidth: 110,
                          }}
                        >
                          {item.id}
                        </span>
                        <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--text)" }}>
                            {item.temple ?? "—"}
                            {item.label ? <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>· {item.label}</span> : null}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1, fontFamily: "ui-monospace, monospace" }}>
                            {item.length_ft}×{item.width_ft}×{item.thickness_ft} in
                            {isPlanned && (
                              <span style={{ marginLeft: 8 }}>
                                · from <strong style={{ color: "#b91c1c" }}>{item.donor_block_id}</strong>
                              </span>
                            )}
                          </div>
                        </span>
                        {badge && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 4,
                              background: badge.bg,
                              color: badge.fg,
                              border: `1px solid ${badge.border}`,
                              letterSpacing: "0.04em",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ⏱ {badge.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "10px 18px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span className="muted" style={{ fontSize: 11 }}>
                Click a row to toggle. Selected slabs are pinned to the top.
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="primary-button"
                style={{ fontSize: 13 }}
              >
                Done · {totalSelected} selected
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
