"use client";

/**
 * Custom vendor / supplier combobox (replaces the browser-native <select>).
 *
 * A styled trigger button opens a portal panel (so the form's overflow:hidden
 * can't clip it) with a live search box, a scrollable list, and an inline
 * "Add new vendor" row. Carries the chosen name into the parent form via a
 * hidden input. Keeps the original submit-guard: if the operator typed a new
 * vendor but didn't press Create, the parent submit is blocked with a prompt.
 */

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { addBlockVendorAction } from "./actions";

export function VendorSelect({
  vendors: initialVendors,
  defaultValue,
  name = "vendor_name",
}: {
  vendors: string[];
  defaultValue?: string | null;
  name?: string;
}) {
  const [vendorList, setVendorList] = useState<string[]>(initialVendors);
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [submitBlockError, setSubmitBlockError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = vendorList.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase()));

  function reposition() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Trigger scrolled fully out of view (e.g. the edit drawer scrolled) →
    // close rather than leave the panel floating at a stale position.
    if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  function openPanel() {
    reposition();
    setOpen(true);
    setQuery("");
    setSubmitBlockError("");
    // Focus the search box once the panel paints.
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  // Close ONLY hides the panel — a pending "add new vendor" (showAdd + newName)
  // is deliberately preserved so the parent-form submit-guard can still catch
  // "you typed a vendor but didn't press Create" after an outside-click close.
  function closePanel() {
    setOpen(false);
  }

  function pick(v: string) {
    setSelected(v);
    closePanel();
    setSubmitBlockError("");
  }

  // Keep the portal panel glued to the trigger while open.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Outside-click + Esc close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closePanel(); }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await addBlockVendorAction(trimmed);
      if ("error" in result) {
        setAddError(result.error);
      } else {
        const canonical = result.canonicalName;
        const next = vendorList.includes(canonical)
          ? [...vendorList].sort((a, b) => a.localeCompare(b))
          : [...vendorList, canonical].sort((a, b) => a.localeCompare(b));
        setVendorList(next);
        setSelected(canonical);
        setNewName("");
        setAddError("");
        setSubmitBlockError("");
        setShowAdd(false);
        setOpen(false);
        // Return focus to the trigger so keyboard users aren't stranded after
        // the panel (and its inputs) unmount.
        requestAnimationFrame(() => btnRef.current?.focus());
      }
    });
  }

  // Parent-form submit guard: typed a new vendor but didn't press Create.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (showAdd && newName.trim() !== "") {
        e.preventDefault();
        e.stopPropagation();
        setSubmitBlockError("Press 'Create' to save the new vendor before submitting.");
        openPanel();
      } else if (showAdd && newName.trim() === "") {
        setShowAdd(false);
      }
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, newName]);

  return (
    <div ref={wrapRef} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input ref={hiddenRef} type="hidden" name={name} value={selected} />

      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? closePanel() : openPanel())}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          width: "100%", padding: "7px 10px", fontSize: 14, textAlign: "left", cursor: "pointer",
          background: "var(--surface)", border: `1px solid ${open ? "var(--gold)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)", color: selected ? "var(--text)" : "var(--muted)",
          boxShadow: open ? "0 0 0 3px var(--gold-subtle)" : "none", transition: "border-color .15s, box-shadow .15s",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected || "— Select vendor —"}
        </span>
        <span style={{ flexShrink: 0, fontSize: 10, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 240), zIndex: 4000,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)", overflow: "hidden",
            display: "flex", flexDirection: "column", maxHeight: 320,
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 Search vendor…"
              style={{ width: "100%", fontSize: 13, padding: "7px 9px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length === 1) { e.preventDefault(); pick(filtered[0]); }
                // Esc clears the search first; only closes the panel once empty.
                if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
              }}
            />
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {selected && (
              <button type="button" onClick={() => pick("")} style={rowStyle(false)}>
                <span style={{ color: "var(--muted)" }}>— Clear / none —</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 12px", fontSize: 12.5, color: "var(--muted)" }}>
                No vendor matches “{query}”.
              </div>
            ) : (
              filtered.map((v) => {
                const isSel = v === selected;
                return (
                  <button key={v} type="button" onClick={() => pick(v)} style={rowStyle(isSel)}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                    {isSel && <span style={{ color: "var(--gold-dark)", fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", padding: 8 }}>
            {showAdd ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setAddError(""); setSubmitBlockError(""); }}
                  placeholder="New vendor name"
                  autoFocus
                  style={{ flex: 1, fontSize: 13 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setShowAdd(false); setNewName(""); }
                  }}
                />
                <button type="button" className="secondary-button" onClick={handleAdd} disabled={isPending || !newName.trim()} style={{ whiteSpace: "nowrap", fontSize: 12, padding: "5px 10px" }}>
                  {isPending ? "…" : "Create"}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); setNewName(""); setAddError(""); setSubmitBlockError(""); }} title="Cancel" style={{ fontSize: 14, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setShowAdd(true); requestAnimationFrame(() => searchRef.current?.blur()); }}
                style={{ ...rowStyle(false), color: "var(--gold-dark)", fontWeight: 700, borderRadius: 6 }}
              >
                ＋ Add new vendor…
              </button>
            )}
            {addError && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>{addError}</div>}
          </div>
        </div>,
        document.body,
      )}

      {submitBlockError && (
        <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>⚠ {submitBlockError}</span>
      )}
    </div>
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    width: "100%", padding: "9px 12px", fontSize: 13.5, textAlign: "left", cursor: "pointer",
    border: "none", background: active ? "var(--gold-subtle)" : "transparent", color: "var(--text)",
  };
}
