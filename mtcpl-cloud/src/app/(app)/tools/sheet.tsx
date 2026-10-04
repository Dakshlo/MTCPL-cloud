"use client";

/**
 * The crib's overlay shell.
 *
 * Bottom sheet on a phone, centred card on a desktop. One component so
 * the two layouts can never drift, and so every overlay in this module
 * closes the same way (backdrop tap, Escape, the ✕).
 *
 * PORTALED TO BODY on purpose. A `transform` or `filter` on any ancestor
 * becomes the containing block for `position: fixed`, which has already
 * bitten this codebase once — a modal inside a hover-lift card jittered
 * and mis-positioned. The tool cards lift on hover, so a sheet rendered
 * in place would land in exactly that trap.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  tone = "gold",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "gold" | "danger";
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Stop the page scrolling behind the sheet — on a phone that
    // "scrolling the wrong thing" feeling is the main sign of a
    // bolted-on overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const accent = tone === "danger" ? "var(--danger)" : "var(--gold)";

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(20,15,6,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      className="tc-sheet-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tc-sheet"
        style={{
          width: "100%", maxWidth: 480, maxHeight: "92vh",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderBottom: "none",
          borderRadius: "20px 20px 0 0",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Grab handle — reads as "this slides" on a touch screen. */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: "var(--border)" }} />
        </div>

        <div style={{ padding: "10px 20px 12px", borderBottom: "1px solid var(--border-light)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>
                {title}
              </div>
              {subtitle != null && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>
                  {subtitle}
                </div>
              )}
            </div>
            <button
              type="button" onClick={onClose} aria-label="Close"
              style={{
                border: "none", background: "var(--bg)", color: "var(--muted)",
                width: 32, height: 32, borderRadius: 10, fontSize: 16,
                cursor: "pointer", flex: "0 0 auto", lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: accent, marginTop: 12, opacity: 0.9 }} />
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>

        {footer != null && (
          <div
            style={{
              padding: "12px 20px calc(14px + env(safe-area-inset-bottom, 0px))",
              borderTop: "1px solid var(--border-light)",
              background: "var(--surface-alt)",
            }}
          >
            {footer}
          </div>
        )}
      </div>

      <style>{`
        /* Phone: a sheet rising from the bottom, thumb-reachable.
           Desktop: a centred card, because a bottom sheet on a 27"
           monitor is a phone affectation. */
        @media (min-width: 720px) {
          .tc-sheet-backdrop { align-items: center; }
          .tc-sheet {
            border-radius: 18px !important;
            border-bottom: 1px solid var(--border) !important;
            box-shadow: 0 24px 70px rgba(0,0,0,0.35) !important;
            max-height: 86vh !important;
          }
          .tc-sheet > div:first-child { display: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
