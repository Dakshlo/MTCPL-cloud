"use client";

/**
 * Mig 061 follow-on (Daksh, May 2026) — custom dropdown picker for
 * bill-vendor categories. Replaces the native <select> which looked
 * jarring inside the rest of the Finance department's polished
 * form chrome (rounded inputs, accent borders, card-style pickers).
 *
 * Behaviour:
 *   • Trigger button looks identical to INPUT_STYLE so it slots
 *     into the form grid without breaking the visual rhythm.
 *   • Click → opens a popover anchored below the trigger with:
 *       — "BLOCK PURCHASE" header + the 5 stone sub-types
 *       — divider
 *       — flat top-level categories
 *   • Each row shows the pill chip preview on the right so the
 *     user knows what the chosen value will look like on bill
 *     rows + vendor list.
 *   • Closes on outside click + Escape. Selected option highlighted
 *     with the accounts accent background.
 *   • Legacy free-text values render as a "Legacy: X" row at the
 *     bottom so existing vendors don't silently lose their value.
 *   • Lightweight + dependency-free — uses a single useState +
 *     a useEffect outside-click listener.
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  BILL_VENDOR_CATEGORIES,
  getBillVendorCategory,
  mergeBillVendorCategories,
  type BillVendorCategory,
  type CustomBillVendorCategory,
} from "@/lib/bill-vendor-categories";
import { ACCOUNTS_TOKENS, INPUT_STYLE } from "../_ui/components";
import { createBillVendorCustomCategoryAction } from "../actions";

export function CategoryPicker({
  value,
  onChange,
  placeholder = "— Pick a category —",
  disabled,
  customCategories = [],
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Mig 082 — user-created categories. Caller fetches from the
   *  page's server component and passes the array in. The picker
   *  merges them under a "Custom" group at the bottom of the list
   *  and exposes a "+ Create new category" inline form so a user
   *  can mint a new one without leaving the vendor / due-bills
   *  screen. Defaults to empty for legacy callers. */
  customCategories?: CustomBillVendorCategory[];
}) {
  const [open, setOpen] = useState(false);
  // Local mirror of the prop so a newly-created category appears
  // immediately, without waiting for a full router.refresh round
  // trip. Server-side state still updates via the action's
  // revalidatePath chain.
  const [localCustom, setLocalCustom] = useState<CustomBillVendorCategory[]>(
    customCategories,
  );
  // Keep local in sync if the parent fetches a fresh list.
  useEffect(() => {
    setLocalCustom(customCategories);
  }, [customCategories]);
  // "+ Create new" inline form state. Inputs are revealed below
  // the list; submitting calls the server action + adds the new
  // category to local state.
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // Group the master list once per render — cheap; canonical list
  // is ~10 items + however many custom rows the user has created.
  const merged = mergeBillVendorCategories(localCustom);
  const groups = new Map<string, BillVendorCategory[]>();
  const flat: BillVendorCategory[] = [];
  for (const c of merged) {
    if (c.group) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    } else {
      flat.push(c);
    }
  }

  const selected = value
    ? getBillVendorCategory(value, localCustom)
    : null;
  const isLegacy =
    value && !merged.some((c) => c.value === value);

  async function handleCreate() {
    const label = newLabel.trim();
    if (!label) {
      setCreateErr("Enter a category name.");
      return;
    }
    setCreatePending(true);
    setCreateErr(null);
    const fd = new FormData();
    fd.set("label", label);
    const res = await createBillVendorCustomCategoryAction(fd);
    setCreatePending(false);
    if (!res.ok) {
      setCreateErr(res.error);
      return;
    }
    // Optimistically add the new row + auto-select it so the user's
    // next action (save vendor) carries the slug.
    const newRow: CustomBillVendorCategory = {
      value: res.value,
      label: res.label,
      pill_fg: res.pill_fg,
      pill_bg: res.pill_bg,
    };
    setLocalCustom((prev) => [...prev, newRow]);
    onChange(res.value);
    setNewLabel("");
    setCreating(false);
    setOpen(false);
  }

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        style={{
          ...INPUT_STYLE,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          color: selected ? "var(--text)" : "var(--muted)",
          background: disabled ? ACCOUNTS_TOKENS.surfaceMuted : "#fff",
          borderColor: open ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong,
          boxShadow: open
            ? `0 0 0 3px ${ACCOUNTS_TOKENS.accentLight}`
            : "none",
          transition: "border-color 0.12s, box-shadow 0.12s",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {selected && (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: selected.pill.fg,
                flexShrink: 0,
              }}
            />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected ? selected.label : placeholder}
          </span>
          {isLegacy && (
            <span
              style={{
                fontSize: 10,
                color: ACCOUNTS_TOKENS.warning,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              · Legacy
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: "var(--muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.12s",
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "#fff",
            border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 10,
            boxShadow: ACCOUNTS_TOKENS.shadowLarge,
            padding: 6,
            maxHeight: 360,
            overflowY: "auto",
            animation: "categoryFade 0.12s ease-out",
          }}
        >
          {[...groups.entries()].map(([groupName, items]) => (
            <div key={groupName} style={{ marginBottom: 4 }}>
              <div
                style={{
                  padding: "8px 10px 4px",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: ACCOUNTS_TOKENS.accent,
                  textTransform: "uppercase",
                }}
              >
                {groupName}
              </div>
              {items.map((c) => (
                <Row
                  key={c.value}
                  cat={c}
                  selected={c.value === value}
                  onPick={() => {
                    onChange(c.value);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          ))}

          {flat.length > 0 && (
            <>
              <div
                aria-hidden
                style={{
                  height: 1,
                  margin: "6px 8px",
                  background: ACCOUNTS_TOKENS.border,
                }}
              />
              {flat.map((c) => (
                <Row
                  key={c.value}
                  cat={c}
                  selected={c.value === value}
                  onPick={() => {
                    onChange(c.value);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}

          {isLegacy && (
            <>
              <div
                aria-hidden
                style={{
                  height: 1,
                  margin: "6px 8px",
                  background: ACCOUNTS_TOKENS.border,
                }}
              />
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  color: ACCOUNTS_TOKENS.warning,
                  fontStyle: "italic",
                }}
              >
                Current value <strong>{value}</strong> is from before the
                canonical list — pick a replacement above.
              </div>
            </>
          )}

          {/* Mig 082 follow-on (Daksh) — "+ Create new category" tile
              at the foot of the dropdown. Default state is a single
              compact button; tapping it expands to an inline input
              + save / cancel. The server-side
              createBillVendorCustomCategoryAction validates +
              persists, returns the new slug + pill, and we
              optimistically push it into localCustom so the picker
              re-renders with the new row visible + selected. */}
          <div
            aria-hidden
            style={{
              height: 1,
              margin: "6px 8px",
              background: ACCOUNTS_TOKENS.border,
            }}
          />
          {creating ? (
            <div
              style={{
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: ACCOUNTS_TOKENS.accentLight,
                borderRadius: 8,
                border: `1px solid ${ACCOUNTS_TOKENS.accent}`,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: ACCOUNTS_TOKENS.accent,
                  textTransform: "uppercase",
                }}
              >
                New category
              </div>
              <input
                type="text"
                autoFocus
                maxLength={60}
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value);
                  if (createErr) setCreateErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setCreating(false);
                    setNewLabel("");
                    setCreateErr(null);
                  }
                }}
                placeholder="e.g. Office Supplies"
                style={{
                  ...INPUT_STYLE,
                  fontSize: 13,
                  padding: "8px 10px",
                  background: "#fff",
                }}
              />
              {createErr && (
                <div
                  role="alert"
                  style={{
                    fontSize: 11,
                    color: ACCOUNTS_TOKENS.danger,
                    fontWeight: 600,
                  }}
                >
                  ⚠ {createErr}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewLabel("");
                    setCreateErr(null);
                  }}
                  disabled={createPending}
                  style={{
                    fontSize: 11,
                    padding: "5px 10px",
                    background: "transparent",
                    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                    borderRadius: 6,
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={createPending || !newLabel.trim()}
                  style={{
                    fontSize: 11,
                    padding: "5px 12px",
                    background: ACCOUNTS_TOKENS.accent,
                    color: "#fff",
                    border: `1px solid ${ACCOUNTS_TOKENS.accent}`,
                    borderRadius: 6,
                    cursor:
                      createPending || !newLabel.trim()
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 700,
                    opacity:
                      createPending || !newLabel.trim() ? 0.6 : 1,
                  }}
                >
                  {createPending ? "Saving…" : "+ Create"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                background: "transparent",
                border: `1px dashed ${ACCOUNTS_TOKENS.accent}`,
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 700,
                color: ACCOUNTS_TOKENS.accent,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  ACCOUNTS_TOKENS.accentLight;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span aria-hidden style={{ fontSize: 14 }}>＋</span>
              Create new category
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes categoryFade {
          from { opacity: 0; transform: translateY(-4px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </div>
  );
}

function Row({
  cat,
  selected,
  onPick,
}: {
  cat: BillVendorCategory;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 10px",
        background: selected ? ACCOUNTS_TOKENS.accentLight : "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: "var(--text)",
        textAlign: "left",
        transition: "background 0.08s",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = ACCOUNTS_TOKENS.surfaceMuted;
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: cat.pill.fg,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: selected ? 700 : 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {cat.label}
        </span>
      </span>
      <span
        style={{
          display: "inline-block",
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 8px",
          borderRadius: 999,
          background: cat.pill.bg,
          color: cat.pill.fg,
          letterSpacing: "0.03em",
          marginLeft: 8,
          flexShrink: 0,
        }}
      >
        {cat.label}
      </span>
    </button>
  );
}
