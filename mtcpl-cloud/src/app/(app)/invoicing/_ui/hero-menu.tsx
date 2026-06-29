"use client";

/**
 * HeroMenu (Daksh) — a single hero button that, when clicked, drops a small
 * popover with 2+ destinations to pick from. Used on the Invoicing dashboard to
 * fold related shortcuts under one button (Client billing & GST + Stone & HSN;
 * Installation contract + Work Order Doc).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BUTTON_STYLES } from "../../accounts/_ui/components";

export type HeroMenuItem = { href: string; label: string; hint?: string };

export function HeroMenu({ label, items }: { label: string; items: HeroMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...BUTTON_STYLES.secondary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
        aria-expanded={open}
      >
        {label}
        <span style={{ fontSize: 10, opacity: 0.7, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 40,
            minWidth: 240,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "9px 12px",
                borderRadius: 8,
                textDecoration: "none",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 700,
                background: "transparent",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {it.label}
              {it.hint && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--muted)", marginTop: 1 }}>{it.hint}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
