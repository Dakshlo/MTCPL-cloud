"use client";

/**
 * Generic collapsed-card → center-peek modal wrapper for the
 * settings page. Same UX as SlabSearchBar / BlockSearchBar /
 * MarbleCutLog: a small clickable card on the page that opens a
 * Notion-style centred dialog with the actual content.
 *
 * The children (table, button, etc.) are server-rendered from the
 * parent and passed in as JSX. The wrapper just handles the open /
 * close state and the modal chrome.
 *
 * ── Aug 2026 makeover (Daksh: "it's the page which is worst in both
 * UI and UX") ─────────────────────────────────────────────────────
 * Every Settings row and every Settings modal is this component, so
 * the whole page is rebuilt from here:
 *   • Card: a tinted rounded icon tile, real title/subtitle hierarchy,
 *     a count chip, and a circular chevron that slides on hover —
 *     instead of a flat row with a monospace "Click to open ▸" pill.
 *   • Per-section `tone` so related settings read as a family at a
 *     glance (comms green, people blue, data violet, system amber).
 *   • Modal: springs in, has a real ✕ button (Esc still works), a
 *     gradient header with the same icon tile, and it LOCKS the page
 *     behind it — note the lock targets <html>, since this app sets
 *     body{overflow:hidden} and scrolls on the document element.
 * Keyboard + a11y behaviour is unchanged: Enter/Space opens, Esc and
 * click-outside close.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type PeekTone = "gold" | "green" | "blue" | "violet" | "amber" | "slate";

const TONES: Record<PeekTone, { fg: string; bg: string; ring: string }> = {
  gold:   { fg: "#a16207", bg: "rgba(232,197,114,0.18)", ring: "rgba(232,197,114,0.45)" },
  green:  { fg: "#15803d", bg: "rgba(21,128,61,0.12)",   ring: "rgba(21,128,61,0.35)" },
  blue:   { fg: "#1d4ed8", bg: "rgba(29,78,216,0.11)",   ring: "rgba(29,78,216,0.32)" },
  violet: { fg: "#6d28d9", bg: "rgba(109,40,217,0.11)",  ring: "rgba(109,40,217,0.32)" },
  amber:  { fg: "#b45309", bg: "rgba(180,83,9,0.12)",    ring: "rgba(180,83,9,0.34)" },
  slate:  { fg: "#475569", bg: "rgba(71,85,105,0.10)",   ring: "rgba(71,85,105,0.28)" },
};

export function PeekSection({
  title,
  subtitle,
  count,
  icon,
  tone = "gold",
  children,
  modalMaxWidth = 880,
  triggerStyle,
}: {
  /** Card heading — also rendered as the modal h2. */
  title: string;
  /** One-line description on the card + repeated under the modal h2. */
  subtitle?: string;
  /** Optional count badge (small pill next to the title). */
  count?: number;
  /** Optional emoji or single character shown to the left of the title. */
  icon?: string;
  /** Colour family for the icon tile + accents. */
  tone?: PeekTone;
  /** Modal body content. */
  children: ReactNode;
  /** Max width for the modal dialog (px). Defaults to 880 for tables. */
  modalMaxWidth?: number;
  /** Extra style merged into the collapsed card (e.g. `flex` for card rows). */
  triggerStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const t = TONES[tone] ?? TONES.gold;

  // Esc closes + the page behind is locked while the dialog is up.
  // The lock targets <html>: this app already sets body{overflow:hidden}
  // and scrolls on the document element, so a body lock is a no-op.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <PeekStyles />

      {/* Collapsed card */}
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="peek-card"
        style={{ ["--peek-ring" as string]: t.ring, ...triggerStyle }}
      >
        <span className="peek-icon" style={{ background: t.bg, color: t.fg }} aria-hidden="true">
          {icon ?? "⚙"}
        </span>

        <span className="peek-body">
          <span className="peek-titleline">
            <span className="peek-title">{title}</span>
            {typeof count === "number" && (
              <span className="peek-count" style={{ background: t.bg, color: t.fg }}>
                {count}
              </span>
            )}
          </span>
          {subtitle && <span className="peek-sub">{subtitle}</span>}
        </span>

        <span className="peek-chev" style={{ color: t.fg, background: t.bg }} aria-hidden="true">
          ›
        </span>
      </div>

      {/* Center-peek modal */}
      {open && (
        <div
          className="peek-scrim"
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="peek-dialog"
            style={{ maxWidth: modalMaxWidth }}
          >
            {/* Header */}
            <div className="peek-dialog-head">
              <span className="peek-icon" style={{ background: t.bg, color: t.fg }} aria-hidden="true">
                {icon ?? "⚙"}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 className="peek-dialog-title">
                  {title}
                  {typeof count === "number" && (
                    <span className="peek-count" style={{ background: t.bg, color: t.fg }}>
                      {count}
                    </span>
                  )}
                </h2>
                {subtitle && <p className="peek-dialog-sub">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="peek-close"
                aria-label="Close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="peek-dialog-body">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

/** Scoped stylesheet. Inlined here (rather than globals.css) so the
 *  component stays self-contained wherever it's reused. Repeated
 *  <style> tags with identical content are deduped by the browser. */
function PeekStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.peek-card {
  display: flex; align-items: center; gap: 14px;
  padding: 15px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
  transition: transform .15s cubic-bezier(.22,1,.36,1), box-shadow .15s ease, border-color .15s ease;
}
.peek-card:hover {
  transform: translateY(-2px);
  border-color: var(--peek-ring, var(--gold-border));
  box-shadow: 0 6px 18px rgba(15,23,42,0.09);
}
.peek-card:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }

.peek-icon {
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: 13px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 19px; line-height: 1;
}

.peek-body { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 3px; }
.peek-titleline { display: flex; align-items: center; gap: 9px; min-width: 0; }
.peek-title {
  font-size: 15px; font-weight: 700; color: var(--text);
  letter-spacing: -0.012em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.peek-count {
  font-size: 11.5px; font-weight: 800; padding: 2px 8px;
  border-radius: 999px; flex-shrink: 0; font-variant-numeric: tabular-nums;
}
.peek-sub {
  font-size: 12px; color: var(--muted); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.peek-chev {
  width: 26px; height: 26px; flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 700; line-height: 1;
  transition: transform .15s cubic-bezier(.22,1,.36,1);
}
.peek-card:hover .peek-chev { transform: translateX(3px); }

/* ── Dialog ─────────────────────────────────────────────────────── */
.peek-scrim {
  position: fixed; top: 0; left: var(--content-left); right: 0; bottom: 0;
  background: rgba(15,12,6,0.5);
  backdrop-filter: saturate(150%) blur(5px);
  z-index: 1000;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 8vh 12px 12px;
  overscroll-behavior: contain;
  animation: peekFade .16s ease both;
}
@keyframes peekFade { from { opacity: 0 } to { opacity: 1 } }

.peek-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: 0 24px 70px rgba(0,0,0,0.35);
  width: 100%; max-height: 84vh;
  display: flex; flex-direction: column; overflow: hidden;
  overscroll-behavior: contain;
  animation: peekPop .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes peekPop {
  from { transform: translateY(10px) scale(.985); opacity: 0 }
  to   { transform: translateY(0) scale(1);      opacity: 1 }
}

.peek-dialog-head {
  display: flex; align-items: flex-start; gap: 13px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-alt), var(--surface));
}
.peek-dialog-title {
  margin: 0; font-size: 17px; font-weight: 800; color: var(--text);
  letter-spacing: -0.02em;
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
}
.peek-dialog-sub { margin: 4px 0 0; font-size: 12px; color: var(--muted); line-height: 1.45; }

.peek-close {
  width: 32px; height: 32px; flex-shrink: 0;
  border: 1px solid var(--border); background: var(--surface);
  border-radius: 50%; cursor: pointer;
  font-size: 13px; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.peek-close:hover { background: var(--text); color: var(--surface); border-color: var(--text); }

.peek-dialog-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px 18px 20px; }
`,
      }}
    />
  );
}
