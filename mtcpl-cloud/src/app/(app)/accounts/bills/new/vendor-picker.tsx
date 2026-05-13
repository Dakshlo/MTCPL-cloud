"use client";

/**
 * Searchable beneficiary dropdown (combobox pattern).
 *
 *   • Trigger button shows the selected vendor (avatar + name + category).
 *   • Click opens a panel below with a search input + filtered list.
 *   • Type to filter by name / category / GSTIN (substring match).
 *   • Click an option, hit Enter on a highlighted row, or pick with arrows + Enter.
 *   • Escape or click-outside closes.
 *
 * Rendered NOT as a portal (the panel is anchored to the field below).
 * The "+ Add new vendor" flow is separate — that lives in the page header
 * (AddVendorButton).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNTS_TOKENS,
  INPUT_STYLE,
  VendorAvatar,
} from "../../_ui/components";

export type VendorPickerOption = {
  id: string;
  name: string;
  category: string | null;
  gstin: string | null;
};

export function VendorPicker({
  vendors,
  selectedId,
  onChange,
  placeholder = "— Select a vendor —",
}: {
  vendors: VendorPickerOption[];
  selectedId: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = vendors.find((v) => v.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q) ||
        (v.gstin ?? "").toLowerCase().includes(q),
    );
  }, [search, vendors]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Auto-focus search input when the panel opens
  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    setActiveIndex(0);
    return () => cancelAnimationFrame(t);
  }, [open]);

  // Keep highlighted option scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-vendor-idx="${activeIndex}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, filtered.length]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setSearch("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const v = filtered[activeIndex];
      if (v) {
        onChange(v.id);
        setOpen(false);
        setSearch("");
      }
      return;
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Trigger button — looks like an input, behaves like a combobox */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...INPUT_STYLE,
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          background: "#fff",
          textAlign: "left",
          padding: "8px 12px",
          minHeight: 40,
        }}
      >
        {selected ? (
          <>
            <VendorAvatar name={selected.name} size={26} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
                color: "var(--text)",
                fontWeight: 600,
              }}
            >
              {selected.name}
              {(selected.category || selected.gstin) && (
                <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                  ·{" "}
                  {[selected.category, selected.gstin && `GSTIN ${selected.gstin}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
          </>
        ) : (
          <span style={{ flex: 1, color: "var(--muted)", fontSize: 13 }}>
            {placeholder}
          </span>
        )}
        <span
          style={{
            color: "var(--muted)",
            fontSize: 11,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0)",
          }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 10,
            boxShadow: ACCOUNTS_TOKENS.shadowLarge,
            zIndex: 30,
            maxHeight: 360,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Search bar */}
          <div
            style={{
              padding: 8,
              borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
              background: ACCOUNTS_TOKENS.surfaceMuted,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
              aria-hidden="true"
            >
              🔍
            </span>
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKey}
              placeholder="Search by name, category, or GSTIN…"
              style={{
                ...INPUT_STYLE,
                fontSize: 13,
                padding: "7px 10px",
                background: "#fff",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                style={{
                  width: 24,
                  height: 24,
                  border: "none",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: 14,
                  borderRadius: 4,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* List */}
          <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  fontSize: 13,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                {search.trim()
                  ? `No vendors match "${search.trim()}".`
                  : "No vendors yet."}
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  Use <strong>+ Add new vendor</strong> at the top of the page.
                </div>
              </div>
            ) : (
              filtered.map((v, i) => {
                const isActive = i === activeIndex;
                const isSelected = v.id === selectedId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-vendor-idx={i}
                    onClick={() => {
                      onChange(v.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 14px",
                      background: isActive ? ACCOUNTS_TOKENS.accentLight : "transparent",
                      border: "none",
                      borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.08s",
                    }}
                  >
                    <VendorAvatar name={v.name} size={32} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v.name}
                      </div>
                      {(v.category || v.gstin) && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v.category && <span>{v.category}</span>}
                          {v.category && v.gstin && " · "}
                          {v.gstin && (
                            <span style={{ fontFamily: "ui-monospace, monospace" }}>
                              GSTIN {v.gstin}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span
                        style={{
                          color: ACCOUNTS_TOKENS.accent,
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                        aria-label="Selected"
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: "6px 12px",
              borderTop: `1px solid ${ACCOUNTS_TOKENS.border}`,
              background: ACCOUNTS_TOKENS.surfaceMuted,
              fontSize: 10,
              color: "var(--muted)",
              display: "flex",
              gap: 12,
            }}
          >
            <span>
              <kbd style={kbdStyle}>↑↓</kbd> navigate
            </span>
            <span>
              <kbd style={kbdStyle}>↵</kbd> select
            </span>
            <span>
              <kbd style={kbdStyle}>esc</kbd> close
            </span>
            <span style={{ marginLeft: "auto" }}>
              {filtered.length} of {vendors.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "1px 5px",
  background: "#fff",
  border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
  borderRadius: 3,
  fontFamily: "ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text)",
  marginRight: 3,
};
