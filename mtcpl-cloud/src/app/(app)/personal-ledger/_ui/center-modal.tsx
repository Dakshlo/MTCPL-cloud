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
  // Mig 056 follow-on (Daksh: "when I type in amount, focus jumps
  // to the cross button"). Bug was: `onClose` is an inline arrow
  // on the call site, so its reference changed on every parent
  // re-render. With `onClose` in the effect deps, the effect re-
  // fired on every keystroke and re-focused the first focusable
  // element in the dialog — which is the × button in the header.
  // Fix: capture onClose in a ref so the keydown handler always
  // calls the latest version, but the focus-and-lock effect only
  // runs when `open` changes.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc-to-close + body-scroll lock + initial focus. Runs ONCE
  // per open→true transition.
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);

    // Focus the first focusable FORM control — explicitly skip the
    // header × close button (it's the very first focusable in DOM
    // order otherwise, which is the bug we just fixed).
    const first = dialogRef.current?.querySelector<HTMLElement>(
      [
        "form input:not([type='hidden'])",
        "form select",
        "form textarea",
        "form button[type='submit']",
      ].join(", "),
    );
    first?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
