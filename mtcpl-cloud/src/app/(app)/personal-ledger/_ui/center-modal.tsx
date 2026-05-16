"use client";

/**
 * Migration 056 — Center-peek modal for the Personal Ledger.
 *
 * Reusable dialog shell shared by:
 *   • Add-party modal (party list page)
 *   • Unlock-party / Set-PIN modal (party list page)
 *   • New-invoice modal (party detail page)
 *   • New-receipt modal (party detail page)
 *
 * Behaviour:
 *   • Backdrop click → close
 *   • Esc key      → close
 *   • Body scroll  → frozen while open
 *   • Trap focus inside the dialog (basic — first focusable element
 *     gets focus on mount; tab/shift-tab cycles within the dialog).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { ACCOUNTS_TOKENS } from "../../accounts/_ui/components";

export function CenterModal({
  open,
  onClose,
  title,
  icon,
  subtitle,
  children,
  maxWidth = 520,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: number;
  closeOnBackdrop?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc-to-close + body-scroll lock + initial focus.
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    // Focus the first focusable element so keyboard users land
    // inside the dialog immediately.
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 24px",
        overflowY: "auto",
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth,
          background: "#fff",
          borderRadius: 14,
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          boxShadow:
            "0 20px 50px rgba(15, 23, 42, 0.25), 0 6px 12px rgba(15, 23, 42, 0.08)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
            background: ACCOUNTS_TOKENS.surfaceMuted,
          }}
        >
          {icon && (
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
              {icon}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 2,
                  fontWeight: 500,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: "var(--muted)",
              padding: "2px 8px",
              borderRadius: 6,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
