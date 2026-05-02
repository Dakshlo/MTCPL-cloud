"use client";

/**
 * Required-Sizes page search.
 *
 * Two states:
 *   • collapsed — a thin bar above the slab list. Click to open.
 *   • expanded — center-peek modal (Notion-style overlay). Search
 *     across slab id / label / temple / stone / dimensions. Click
 *     anywhere outside the modal (or press Esc) to close.
 *
 * Filters the same `slabs` array the parent page already loaded —
 * no extra DB round-trip. Hands you a click target that scrolls
 * the matching slab card into view in the SlabGrid below.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type Slab = {
  id: string;
  label: string;
  description?: string | null;
  temple: string;
  stone: string | null;
  quality: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
};

export function SlabSearchBar({ slabs }: { slabs: Slab[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the input when the modal opens.
  useEffect(() => {
    if (open) {
      // Defer one tick so the autoFocus fires after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc key closes.
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

  // Compute matches. Cap at 50 so a blank query doesn't try to render
  // every slab in inventory at once.
  const results = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return slabs.slice(0, 50);
    const dims = `${q}`.replace(/\s+/g, "");
    return slabs
      .filter((s) => {
        if (s.id.toLowerCase().includes(lower)) return true;
        if (s.label.toLowerCase().includes(lower)) return true;
        if (s.temple.toLowerCase().includes(lower)) return true;
        if ((s.stone ?? "").toLowerCase().includes(lower)) return true;
        const dimStr = `${s.length_ft}x${s.width_ft}x${s.thickness_ft}`.toLowerCase();
        if (dimStr.includes(dims.toLowerCase())) return true;
        return false;
      })
      .slice(0, 50);
  }, [slabs, q]);

  // Click on a result — scroll the slab card into view in the
  // SlabGrid below, briefly highlight it, and close the modal.
  function handleSelect(slabId: string) {
    setOpen(false);
    // Wait for the modal to close first.
    setTimeout(() => {
      const card = document.querySelector(`[data-slab-id="${CSS.escape(slabId)}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        // Brief outline pulse so the user can see which one matched.
        const original = card.style.boxShadow;
        card.style.transition = "box-shadow 0.3s";
        card.style.boxShadow = "0 0 0 3px var(--gold)";
        setTimeout(() => { card.style.boxShadow = original; }, 1400);
      }
    }, 60);
  }

  return (
    <>
      {/* Collapsed bar — sits between AddSlabForm and the slab list */}
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
          margin: "12px 0 18px",
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-alt)";
          e.currentTarget.style.borderColor = "var(--gold-dark)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--surface)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <span style={{ fontSize: 16, opacity: 0.6 }}>🔎</span>
        <span style={{ flex: 1, color: "var(--muted)", fontSize: 13 }}>
          Search slabs by id, label, temple, stone, or dimensions…
        </span>
        <kbd
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          Click to open
        </kbd>
      </div>

      {/* Center-peek modal */}
      {open && (
        <div
          // Backdrop catches clicks outside the dialog → close.
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
            paddingTop: "12vh",
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
              maxWidth: 640,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Search input */}
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18, opacity: 0.7 }}>🔎</span>
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by id, label, temple, stone, dimensions…"
                style={{
                  flex: 1,
                  fontSize: 15,
                  padding: "6px 0",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                }}
              />
              <kbd
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                }}
                title="Close"
              >
                Esc
              </kbd>
            </div>

            {/* Results list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {results.length === 0 ? (
                <div
                  style={{
                    padding: "32px 18px",
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}
                >
                  No slabs match &ldquo;{q}&rdquo;.
                </div>
              ) : (
                results.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelect(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 16px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-light)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      transition: "background 0.08s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-alt)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--gold-dark)",
                        minWidth: 110,
                      }}
                    >
                      {s.id}
                    </span>
                    <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text)" }}>
                        {s.label}
                        {s.priority && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "#DC2626", fontWeight: 700 }}>⚡</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        🏛 {s.temple} · {s.stone ?? "—"}
                        {s.quality ? ` · Grade ${s.quality}` : ""}
                      </div>
                    </span>
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.length_ft}×{s.width_ft}×{s.thickness_ft}″
                    </span>
                    <span
                      className="role-pill"
                      style={{
                        fontSize: 9,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.status}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "8px 16px",
                borderTop: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--muted)",
                background: "var(--bg)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {results.length === 50
                  ? "Showing first 50 — refine search to see more"
                  : `${results.length} match${results.length === 1 ? "" : "es"}`}
              </span>
              <span style={{ fontStyle: "italic" }}>Click any row to jump to it in the list below</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
