"use client";

/**
 * LabelSelect — searchable combobox for reusable slab labels.
 *
 * - Type freely; the dropdown filters existing labels case-insensitively
 *   by substring.
 * - Click any match (or arrow-down + Enter) to pick it.
 * - If nothing matches your typed text, a "＋ Add '…' as new label" button
 *   appears at the bottom of the dropdown; clicking it saves the label to
 *   slab_labels so it shows up for everyone next time, then selects it.
 * - Form submission uses whatever text is currently in the visible input,
 *   so legacy labels (old free-text values not yet in slab_labels) still
 *   save correctly on edit.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { addSlabLabelAction } from "./actions";

export function LabelSelect({
  labels: initialLabels,
  defaultValue,
  name = "label",
}: {
  labels: string[];
  defaultValue?: string | null;
  name?: string;
}) {
  // If editing a slab whose label predates slab_labels, keep it visible in
  // the dropdown so the user sees their current value and doesn't think they
  // have to re-add it.
  const initialList = (() => {
    const d = (defaultValue ?? "").trim();
    if (d && !initialLabels.includes(d)) {
      return [...initialLabels, d].sort((a, b) => a.localeCompare(b));
    }
    return initialLabels;
  })();

  const [labelList, setLabelList] = useState<string[]>(initialList);
  const [query, setQuery] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [addError, setAddError] = useState("");
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? labelList.filter((l) => l.toLowerCase().includes(q))
    : labelList;
  const exactMatch = labelList.find((l) => l.toLowerCase() === q);
  const canAddNew = q.length > 0 && !exactMatch;
  const totalOptions = filtered.length + (canAddNew ? 1 : 0);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setActiveIdx(-1);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pickLabel(label: string) {
    setQuery(label);
    setOpen(false);
    setActiveIdx(-1);
    setAddError("");
  }

  function handleAddNew() {
    const name = query.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await addSlabLabelAction(name);
      if (result?.error) {
        setAddError(result.error);
      } else {
        const sorted = [...labelList, name].sort((a, b) => a.localeCompare(b));
        setLabelList(sorted);
        pickLabel(name);
      }
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, totalOptions - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (!open) return;
      if (activeIdx >= 0 && activeIdx < filtered.length) {
        e.preventDefault();
        pickLabel(filtered[activeIdx]);
      } else if (activeIdx === filtered.length && canAddNew) {
        e.preventDefault();
        handleAddNew();
      } else if (canAddNew) {
        e.preventDefault();
        handleAddNew();
      } else if (filtered.length === 1) {
        e.preventDefault();
        pickLabel(filtered[0]);
      }
      // else: let the browser submit the surrounding form
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        name={name}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
          setAddError("");
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={labelList.length > 0 ? "Type to search labels…" : "Type a label…"}
        autoComplete="off"
      />
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            marginTop: 3,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {filtered.map((label, i) => {
            const isActive = activeIdx === i;
            const isCurrent = query === label;
            return (
              <div
                key={label}
                role="option"
                aria-selected={isCurrent}
                onClick={() => pickLabel(label)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  background: isActive ? "var(--bg)" : "transparent",
                  color: isCurrent ? "var(--gold-dark)" : "var(--text)",
                  fontWeight: isCurrent ? 700 : 400,
                  borderLeft: isCurrent ? "3px solid var(--gold)" : "3px solid transparent",
                }}
              >
                {label}
              </div>
            );
          })}

          {canAddNew && (
            <button
              type="button"
              onClick={handleAddNew}
              onMouseEnter={() => setActiveIdx(filtered.length)}
              disabled={isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "9px 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--gold-dark)",
                background: activeIdx === filtered.length ? "var(--bg)" : "rgba(184,115,51,0.08)",
                border: "none",
                borderTop: filtered.length > 0 ? "1px solid var(--border)" : "none",
                cursor: isPending ? "wait" : "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 18,
                  height: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--gold-dark)",
                  color: "#fff",
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 800,
                  lineHeight: 1,
                }}
              >
                +
              </span>
              {isPending ? (
                "Adding…"
              ) : (
                <>
                  Add <strong>&ldquo;{query.trim()}&rdquo;</strong> as new label
                </>
              )}
            </button>
          )}

          {filtered.length === 0 && !canAddNew && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>
              No labels yet — start typing to create one.
            </div>
          )}
        </div>
      )}

      {addError && (
        <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>{addError}</div>
      )}
    </div>
  );
}
