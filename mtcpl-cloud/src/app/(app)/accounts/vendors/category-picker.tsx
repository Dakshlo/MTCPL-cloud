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
  type BillVendorCategory,
} from "@/lib/bill-vendor-categories";
import { ACCOUNTS_TOKENS, INPUT_STYLE } from "../_ui/components";

export function CategoryPicker({
  value,
  onChange,
  placeholder = "— Pick a category —",
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // Group the master list once per render — cheap; the list is ~10 items.
  const groups = new Map<string, BillVendorCategory[]>();
  const flat: BillVendorCategory[] = [];
  for (const c of BILL_VENDOR_CATEGORIES) {
    if (c.group) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    } else {
      flat.push(c);
    }
  }

  const selected = value ? getBillVendorCategory(value) : null;
  const isLegacy =
    value && !BILL_VENDOR_CATEGORIES.some((c) => c.value === value);

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
