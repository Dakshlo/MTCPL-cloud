"use client";

/**
 * Center-peek modal that hosts a route inside an iframe.
 *
 * Used to surface heavy server-rendered pages (Block Report, Block
 * Journey) without the full-page nav round-trip. Click the trigger
 * card → modal opens with a near-full-screen iframe; click outside
 * / Esc closes and you're back on the original page where you
 * left off.
 *
 * Iframe target should be a route under /embed/* (those use the
 * minimal embed layout — no sidebar / header — so the content
 * fills the modal cleanly).
 *
 * Same overlay rules as the rest of the app's center-peek modals:
 * the backdrop starts at var(--content-left) (= sidebar width on
 * desktop, 0 on mobile) so the dialog visually centres over the
 * working area, not the whole viewport.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function PeekIframe({
  url,
  triggerLabel,
  triggerSubtitle,
  triggerIcon,
  modalTitle,
  modalSubtitle,
  triggerClassName,
  triggerStyle,
  triggerContent,
}: {
  /** URL to load in the iframe — typically /embed/<something>. */
  url: string;
  /** Default trigger card text + chrome (used when triggerContent is omitted). */
  triggerLabel?: string;
  triggerSubtitle?: string;
  triggerIcon?: string;
  /** Modal header — defaults to triggerLabel. */
  modalTitle?: string;
  modalSubtitle?: string;
  /**
   * Override the default card chrome with custom JSX. Useful when the
   * caller wants the trigger to look different (e.g. an existing
   * dashboard tile, an inline button). Click handler is wired
   * automatically by wrapping the children in a clickable div.
   */
  triggerContent?: ReactNode;
  /** Style overrides for the default trigger. */
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc closes
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

  // Lock body scroll while the iframe modal is open — otherwise
  // scrolling inside the iframe ALSO scrolls the parent.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Trigger */}
      {triggerContent ? (
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
          style={{ cursor: "pointer", display: "contents" }}
        >
          {triggerContent}
        </div>
      ) : (
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
          className={triggerClassName ?? "settings-section"}
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            background: "var(--surface)",
            border: "2px dashed var(--border)",
            borderRadius: 10,
            transition: "background 0.12s, border-color 0.12s",
            ...triggerStyle,
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
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
              {triggerIcon && <span style={{ marginRight: 6 }}>{triggerIcon}</span>}
              {triggerLabel}
            </p>
            {triggerSubtitle && (
              <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
                {triggerSubtitle}
              </p>
            )}
          </div>
          <span
            className="role-pill"
            style={{
              background: "var(--gold)",
              color: "#fff",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Open →
          </span>
        </div>
      )}

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
            alignItems: "stretch",
            justifyContent: "center",
            padding: "3vh 2vw",
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
              maxWidth: 1400,
              maxHeight: "94vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header — slim, just to give the modal a close affordance */}
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>
                  {triggerIcon && <span style={{ marginRight: 6 }}>{triggerIcon}</span>}
                  {modalTitle ?? triggerLabel ?? ""}
                </h2>
                {(modalSubtitle ?? triggerSubtitle) && (
                  <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                    {modalSubtitle ?? triggerSubtitle}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <a
                  href={url.replace(/^\/embed/, "")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ghost-button"
                  style={{ fontSize: 11, textDecoration: "none", padding: "3px 9px" }}
                  title="Open the standalone page in a new tab"
                >
                  ↗ Full page
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "3px 9px" }}
                >
                  Esc · Close
                </button>
              </div>
            </div>

            {/* Iframe body */}
            <iframe
              src={url}
              style={{
                flex: 1,
                width: "100%",
                border: "none",
                display: "block",
                background: "var(--bg)",
              }}
              title={modalTitle ?? triggerLabel ?? "Embedded view"}
            />
          </div>
        </div>
      )}
    </>
  );
}
