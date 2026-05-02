"use client";

/**
 * Generic collapsed-card → center-peek modal wrapper for the
 * settings page. Same UX as SlabSearchBar / BlockSearchBar /
 * MarbleCutLog: a small clickable card on the page that opens a
 * Notion-style centred dialog with the actual content.
 *
 * Used to host:
 *   • Screen Time Today
 *   • Audit Log
 *   • Full System Backup
 *
 * The children (table, button, etc.) are server-rendered from the
 * parent and passed in as JSX. The wrapper just handles the open /
 * close state and the modal chrome.
 *
 * Click outside / Esc closes. The collapsed card preserves the same
 * 12px-padding `settings-section` look so it sits naturally next to
 * the rest of the settings page.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function PeekSection({
  title,
  subtitle,
  count,
  icon,
  children,
  modalMaxWidth = 880,
}: {
  /** Card heading — also rendered as the modal h2. */
  title: string;
  /** One-line description on the card + repeated under the modal h2. */
  subtitle?: string;
  /** Optional count badge (small pill next to the title). */
  count?: number;
  /** Optional emoji or single character shown to the left of the title. */
  icon?: string;
  /** Modal body content. */
  children: ReactNode;
  /** Max width for the modal dialog (px). Defaults to 880 for tables. */
  modalMaxWidth?: number;
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

  return (
    <>
      {/* Collapsed card */}
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
        className="settings-section"
        style={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 18px",
          transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-alt)";
          e.currentTarget.style.borderColor = "var(--gold-dark)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "";
          e.currentTarget.style.borderColor = "";
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
              {title}
            </span>
            {typeof count === "number" && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  background: "var(--surface-alt)",
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            )}
          </div>
          {subtitle && (
            <p
              className="muted"
              style={{ fontSize: 12, margin: "4px 0 0" }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            padding: "3px 9px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Click to open ▸
        </span>
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
            // Skip the sidebar so the modal centres over the working
            // content area, not the whole viewport. --content-left
            // resolves to --sidebar-width on desktop and 0 on mobile.
            left: "var(--content-left)",
            right: 0,
            bottom: 0,
            background: "rgba(15, 12, 6, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "8vh",
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
              maxWidth: modalMaxWidth,
              maxHeight: "84vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 17, display: "flex", alignItems: "center", gap: 10 }}>
                  {icon && <span>{icon}</span>}
                  <span>{title}</span>
                  {typeof count === "number" && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        background: "var(--surface-alt)",
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontWeight: 600,
                      }}
                    >
                      {count}
                    </span>
                  )}
                </h2>
                {subtitle && (
                  <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                    {subtitle}
                  </p>
                )}
              </div>
              <kbd
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                  whiteSpace: "nowrap",
                }}
                title="Close"
              >
                Esc
              </kbd>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 16px" }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
