"use client";

/**
 * Cutting page history search.
 *
 * Searches across the Earlier (done, not today) and Rejected sections
 * of the Done tab. Same UX as BlockSearchBar / SlabSearchBar:
 *   • Click the collapsed bar → center-peek modal with live search
 *   • Click outside / Esc closes
 *   • Click a result → scrolls + briefly highlights the matching card
 *
 * Searches across block_id, session_code, stone, status, dim string,
 * and the per-row date string ("28 Apr 2026"). All client-side over
 * the rows the parent already loaded — no extra DB round-trip.
 *
 * Cards must carry a `data-cut-block-id={block.id}` attribute (the
 * cut_session_block UUID) for scroll-to-row to work.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type HistoryRow = {
  /** cut_session_block UUID (used as the data-cut-block-id attribute). */
  id: string;
  /** Real block code (MT-B-064 etc) — what the user actually searches by. */
  block_id: string;
  /** "done" or "rejected" — drives the badge tint. */
  status: "done" | "rejected";
  /** Session label (e.g. CUT-202604280803). */
  session_code: string | null;
  stone: string | null;
  yard: number | null;
  l: number | null;
  w: number | null;
  h: number | null;
  /** updated_at — when cutting completed (or rejection happened). */
  updated_at: string | null;
  /** Number of slabs cut (real, including manual extras). */
  slab_count: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CuttingHistorySearchBar({ rows }: { rows: HistoryRow[] }) {
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
    if (!lower) return rows.slice(0, 50);
    const dimsQ = lower.replace(/\s+/g, "");
    return rows
      .filter((r) => {
        if (r.block_id.toLowerCase().includes(lower)) return true;
        if ((r.session_code ?? "").toLowerCase().includes(lower)) return true;
        if ((r.stone ?? "").toLowerCase().includes(lower)) return true;
        if ((r.status ?? "").toLowerCase().includes(lower)) return true;
        if (r.yard != null && (`yard${r.yard}`.includes(lower) || `y${r.yard}`.includes(lower))) return true;
        const dimStr = `${r.l ?? ""}x${r.w ?? ""}x${r.h ?? ""}`.toLowerCase();
        if (dimStr.includes(dimsQ)) return true;
        const dateStr = fmtDate(r.updated_at).toLowerCase();
        if (dateStr.includes(lower)) return true;
        return false;
      })
      .slice(0, 50);
  }, [rows, q]);

  function handleSelect(cutBlockId: string) {
    setOpen(false);
    setTimeout(() => {
      // Open any collapsed <details> ancestor so the row is visible
      // before we scroll to it.
      const card = document.querySelector(`[data-cut-block-id="${CSS.escape(cutBlockId)}"]`);
      if (card instanceof HTMLElement) {
        let el: HTMLElement | null = card;
        while (el) {
          if (el.tagName === "DETAILS") (el as HTMLDetailsElement).open = true;
          el = el.parentElement;
        }
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
      {/* Collapsed bar — sits between the Done Today list and the
          Earlier/Rejected sections. */}
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
          margin: "16px 0 12px",
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
          Search Earlier + Rejected blocks by id, session, stone, dimensions, date…
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
              maxWidth: 720,
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
                placeholder="Search by block id, session, stone, dimensions, date…"
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
                  No earlier or rejected blocks match &ldquo;{q}&rdquo;.
                </div>
              ) : (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelect(r.id)}
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
                        color: r.status === "rejected" ? "#b91c1c" : "var(--gold-dark)",
                        minWidth: 110,
                      }}
                    >
                      {r.block_id}
                    </span>
                    <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text)" }}>
                        {r.stone ?? "—"}
                        {r.session_code ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)" }}>{r.session_code}</span> : null}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        {r.yard != null ? `Yard ${r.yard}` : ""}
                        {r.updated_at ? ` · ${fmtDate(r.updated_at)}` : ""}
                        {` · ${r.slab_count} slab${r.slab_count === 1 ? "" : "s"}`}
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
                      {r.l ?? "?"}×{r.w ?? "?"}×{r.h ?? "?"}″
                    </span>
                    <span
                      className={r.status === "rejected" ? "role-pill badge-discarded" : "role-pill badge-available"}
                      style={{ fontSize: 9, whiteSpace: "nowrap" }}
                    >
                      {r.status === "rejected" ? "Rejected" : "✓ Done"}
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
              <span style={{ fontStyle: "italic" }}>Click any row to jump and highlight</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
