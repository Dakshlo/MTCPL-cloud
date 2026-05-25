"use client";

// ──────────────────────────────────────────────────────────────────
// Cutting Done — PDF download button
// ──────────────────────────────────────────────────────────────────
// Daksh May 2026 round 3 — sits next to the Print button on the
// Done tab. Two modes:
//
//   1. "Done Today" — instant download of today's blocks.
//   2. "Select by Tick" — opens a center peek modal listing every
//      done block (today + earlier) latest first, with a search bar.
//      User ticks the wanted blocks, hits Generate PDF → download.
//
// Both modes hit /api/cutting/done-pdf which builds the PDF
// server-side with pdf-lib. Mounted only when activeTab === "done"
// so it doesn't clutter the other tabs.

import { useEffect, useMemo, useRef, useState } from "react";

export type DonePdfBlock = {
  /** cut_session_blocks.id — used as the API filter key. */
  id: string;
  /** block_id — what the user sees, e.g. "MT-B-387". */
  blockCode: string;
  stone: string;
  /** YYYY-MM-DD or pretty date string for the row subtitle. */
  cutDate: string;
  /** "53×30×29″" or "3.018 T" for marble. Optional context line. */
  dimsOrTonnes: string;
  /** Number of slabs cut (for the row subtitle). */
  slabCount: number;
  /** Whether this block is in today's window (drives the section header). */
  isToday: boolean;
};

export function DownloadDonePdfButton({
  blocks,
}: {
  /** Combined today + earlier rows, latest-first ordering preserved. */
  blocks: DonePdfBlock[];
}) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click / Esc
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function downloadTodayPdf() {
    setOpen(false);
    window.open("/api/cutting/done-pdf", "_blank", "noopener,noreferrer");
  }

  function openTickModal() {
    setOpen(false);
    setModalOpen(true);
  }

  return (
    <>
      <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 16px",
            background: "var(--surface)",
            color: "var(--gold-dark)",
            border: "1.5px solid var(--gold-dark)",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Download a PDF of done blocks"
        >
          📄 PDF {open ? "▲" : "▼"}
        </button>
        {open && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 240,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
              zIndex: 50,
              overflow: "hidden",
            }}
          >
            <DropdownItem
              icon="📅"
              title="Done Today"
              subtitle="One-click PDF of every block cut today"
              onClick={downloadTodayPdf}
            />
            <div style={{ height: 1, background: "var(--border)" }} />
            <DropdownItem
              icon="✓"
              title="Select by Tick"
              subtitle="Pick specific blocks from a searchable list"
              onClick={openTickModal}
            />
          </div>
        )}
      </div>

      {modalOpen && (
        <TickModal
          blocks={blocks}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function DropdownItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        width: "100%",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(201,151,58,0.10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: 1,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.35 }}>
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function TickModal({
  blocks,
  onClose,
}: {
  blocks: DonePdfBlock[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter((b) => {
      const hay = [b.blockCode, b.stone, b.dimsOrTonnes, b.cutDate]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, blocks]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const allSelected =
      filtered.length > 0 && filtered.every((b) => selected.has(b.id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const b of filtered) next.delete(b.id);
      } else {
        for (const b of filtered) next.add(b.id);
      }
      return next;
    });
  }

  function generate() {
    if (selected.size === 0) return;
    const ids = [...selected].join(",");
    window.open(
      `/api/cutting/done-pdf?blocks=${encodeURIComponent(ids)}`,
      "_blank",
      "noopener,noreferrer",
    );
    onClose();
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((b) => selected.has(b.id));

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-alt)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              PDF · Select by tick
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.005em",
              }}
            >
              Pick done blocks for PDF
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {blocks.length} done block{blocks.length === 1 ? "" : "s"}{" "}
              available · latest first
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              padding: "6px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Search + select-all */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by block ID, stone, date…"
            style={{
              flex: 1,
              fontSize: 13,
              padding: "8px 12px",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          />
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={toggleAllVisible}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "8px 12px",
                background: "transparent",
                color: "var(--gold-dark)",
                border: "1px solid var(--gold-dark)",
                borderRadius: 6,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {allVisibleSelected
                ? `Untick ${filtered.length}`
                : `Tick all ${filtered.length}`}
            </button>
          )}
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "40px 16px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              {query
                ? `No blocks match "${query.trim()}"`
                : "No done blocks to pick from."}
            </div>
          ) : (
            filtered.map((b) => {
              const isSelected = selected.has(b.id);
              return (
                <label
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: isSelected ? "rgba(201,151,58,0.08)" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(b.id)}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 700,
                          fontSize: 13,
                          color: "var(--text)",
                        }}
                      >
                        {b.blockCode}
                      </span>
                      {b.isToday && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "rgba(16,185,129,0.18)",
                            color: "#047857",
                            letterSpacing: "0.04em",
                          }}
                        >
                          TODAY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {b.stone} · {b.dimsOrTonnes} · {b.slabCount} slab
                      {b.slabCount === 1 ? "" : "s"} · {b.cutDate}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-alt)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{selected.size}</strong>{" "}
            selected
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="ghost-button"
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={selected.size === 0}
              style={{
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 700,
                background: selected.size > 0 ? "var(--gold-dark)" : "var(--surface-alt)",
                color: selected.size > 0 ? "#fff" : "var(--muted)",
                border: `1px solid ${selected.size > 0 ? "var(--gold-dark)" : "var(--border)"}`,
                borderRadius: 8,
                cursor: selected.size > 0 ? "pointer" : "not-allowed",
              }}
            >
              📄 Generate PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
