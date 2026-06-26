"use client";

/**
 * Blocks Inventory page search.
 *
 * Same UX as the SlabSearchBar (slabs/slab-search-bar.tsx):
 *   • collapsed bar above the BlockGrid
 *   • click → center-peek modal with live search
 *   • click outside / Esc closes
 *   • click a result → scrolls + briefly highlights the matching
 *     card in the BlockGrid below
 *
 * Searches across id, stone, yard, vendor, truck_no, bill_no, and
 * the dim string ("88x53x30"). All client-side over the same array
 * the parent page already loaded — no extra DB round-trip.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { matchesDimSearch } from "@/lib/dimension-search";

type Block = {
  id: string;
  stone: string;
  yard: number;
  category: string | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  status: string;
  quality: string | null;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
};

export function BlockSearchBar({ blocks }: { blocks: Block[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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

  const results = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return blocks.slice(0, 50);
    return blocks
      .filter((b) => {
        if (b.id.toLowerCase().includes(lower)) return true;
        if ((b.stone ?? "").toLowerCase().includes(lower)) return true;
        if ((b.vendor_name ?? "").toLowerCase().includes(lower)) return true;
        if ((b.truck_no ?? "").toLowerCase().includes(lower)) return true;
        if ((b.bill_no ?? "").toLowerCase().includes(lower)) return true;
        if ((b.status ?? "").toLowerCase().includes(lower)) return true;
        if (`yard${b.yard}`.includes(lower) || `y${b.yard}`.includes(lower)) return true;
        // Order-insensitive: any ordering of L×W×H matches.
        if (matchesDimSearch(lower, [b.length_ft, b.width_ft, b.height_ft])) return true;
        return false;
      })
      .slice(0, 50);
  }, [blocks, q]);

  function handleSelect(blockId: string) {
    setOpen(false);
    setTimeout(() => {
      const card = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        const original = card.style.boxShadow;
        card.style.transition = "box-shadow 0.3s";
        card.style.boxShadow = "0 0 0 3px var(--gold)";
        setTimeout(() => { card.style.boxShadow = original; }, 1400);
      }
    }, 60);
  }

  return (
    <>
      {/* Collapsed bar */}
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
          Search blocks by id, stone, yard, vendor, truck no, dimensions…
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
                placeholder="Search by id, stone, yard, vendor, truck no, dimensions…"
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
                  No blocks match &ldquo;{q}&rdquo;.
                </div>
              ) : (
                results.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelect(b.id)}
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
                      {b.id}
                    </span>
                    <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text)" }}>
                        {b.stone}
                        {b.quality ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)" }}>Grade {b.quality}</span> : null}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        Yard {b.yard}
                        {b.vendor_name ? ` · ${b.vendor_name}` : ""}
                        {b.truck_no ? ` · ${b.truck_no}` : ""}
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
                      {b.length_ft ?? "?"}×{b.width_ft ?? "?"}×{b.height_ft ?? "?"}″
                    </span>
                    <span
                      className="role-pill"
                      style={{
                        fontSize: 9,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.status}
                    </span>
                  </button>
                ))
              )}
            </div>

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
              <span style={{ fontStyle: "italic" }}>Click any row to jump to it in the grid below</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
