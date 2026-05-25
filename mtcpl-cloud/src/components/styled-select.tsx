"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Generic searchable combobox-style picker. Replaces native <select>
 * where the OS-dark-mode dropdown panel sticks out against the app's
 * gold-on-cream / dark theme. Pure theme-token styling (var(--surface),
 * var(--border), var(--gold), var(--text), var(--muted), etc.) so the
 * same component drops into any page without tweaking.
 *
 * Behaviour:
 *   • Trigger button looks like a styled input. Click toggles the panel.
 *   • Search bar appears when options.length > searchThreshold (default
 *     6) — typing filters by label + optional subtitle/keywords.
 *   • Keyboard: ArrowDown / ArrowUp move highlight, Enter selects,
 *     Escape closes. Click-outside closes.
 *   • The currently-selected option is marked with a gold ✓.
 *
 * Form integration: this is a controlled component — the caller owns
 * the value state and writes it to a hidden <input name="…"> alongside,
 * so the parent form submits the chosen id naturally.
 */

export type StyledSelectOption = {
  /** Stored value submitted with the form. */
  value: string;
  /** Primary label shown on the row + the trigger. */
  label: string;
  /** Optional second line shown under the label (muted). */
  subtitle?: string;
  /** Optional extra search terms (e.g. code prefix, GSTIN). */
  keywords?: string;
  /** Optional leading glyph rendered before the label. */
  icon?: string;
};

export function StyledSelect({
  options,
  value,
  onChange,
  placeholder = "— select —",
  searchPlaceholder = "Search…",
  searchThreshold = 6,
  required = false,
  disabled = false,
}: {
  options: StyledSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  searchThreshold?: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const showSearch = options.length > searchThreshold;
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = [o.label, o.subtitle ?? "", o.keywords ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [query, options]);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the search box (if shown) when the panel opens, and reset
  // the keyboard highlight to the top of the filtered list.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    if (showSearch) {
      const t = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
  }, [open, showSearch]);

  // Keep highlighted row scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-styled-idx="${activeIndex}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, filtered.length]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[activeIndex];
      if (o) {
        onChange(o.value);
        setOpen(false);
        setQuery("");
      }
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          style={{
            position: "absolute",
            opacity: 0,
            pointerEvents: "none",
            width: 1,
            height: 1,
            padding: 0,
            margin: 0,
            border: 0,
          }}
        />
      )}
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          fontSize: 13,
          background: disabled ? "var(--surface-alt)" : "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          minHeight: 38,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected ? "var(--text)" : "var(--muted)",
            fontWeight: selected ? 600 : 400,
          }}
        >
          {selected ? (
            <>
              {selected.icon && (
                <span style={{ marginRight: 6 }}>{selected.icon}</span>
              )}
              {selected.label}
              {selected.subtitle && (
                <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                  · {selected.subtitle}
                </span>
              )}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span
          aria-hidden
          style={{
            color: "var(--muted)",
            fontSize: 10,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0)",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            zIndex: 50,
            maxHeight: 320,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {showSearch && (
            <div
              style={{
                padding: 8,
                borderBottom: "1px solid var(--border)",
                background: "var(--surface-alt)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                🔍
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKey}
                placeholder={searchPlaceholder}
                style={{
                  flex: 1,
                  fontSize: 13,
                  padding: "6px 8px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  outline: "none",
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
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
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  fontSize: 12,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                {query.trim()
                  ? `No matches for "${query.trim()}"`
                  : "No options"}
              </div>
            ) : (
              filtered.map((o, i) => {
                const isActive = i === activeIndex;
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-styled-idx={i}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 14px",
                      background: isActive
                        ? "rgba(201,151,58,0.12)"
                        : "transparent",
                      color: "var(--text)",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.08s",
                    }}
                  >
                    {o.icon && (
                      <span
                        aria-hidden
                        style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}
                      >
                        {o.icon}
                      </span>
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {o.label}
                      </span>
                      {o.subtitle && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {o.subtitle}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <span
                        aria-label="Selected"
                        style={{
                          color: "var(--gold-dark)",
                          fontSize: 14,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
