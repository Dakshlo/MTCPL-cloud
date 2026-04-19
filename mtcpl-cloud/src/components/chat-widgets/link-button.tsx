"use client";

/**
 * Generic jump-to-page button. Triggered by:
 *
 *   [[LINK:{"href":"/cutting/abc-123","label":"See cutting progress","icon":"🔪"}]]
 *
 * Use this whenever the AI references a specific page or workflow the user
 * should open directly (a cutting session, a plan page, a report with
 * pre-filled filters). For blocks/temples the dedicated BLOCK / TEMPLE
 * cards have their own links built in — this is for everything else.
 */

import Link from "next/link";

export type LinkButtonProps = {
  href: string;
  label: string;
  icon?: string;
  variant?: "primary" | "secondary";
};

export function LinkButton({ href, label, icon, variant = "primary" }: LinkButtonProps) {
  const isExternal = /^https?:\/\//.test(href);
  const isPrimary = variant === "primary";

  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 13px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    margin: "4px 6px 4px 0",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    whiteSpace: "nowrap",
    ...(isPrimary
      ? {
          background: "rgba(232,197,114,0.12)",
          color: "#E8C572",
          border: "1px solid rgba(232,197,114,0.35)",
        }
      : {
          background: "transparent",
          color: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(255,255,255,0.15)",
        }),
  };

  const onEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isPrimary) {
      e.currentTarget.style.background = "rgba(232,197,114,0.22)";
      e.currentTarget.style.borderColor = "rgba(232,197,114,0.6)";
    } else {
      e.currentTarget.style.background = "rgba(255,255,255,0.06)";
      e.currentTarget.style.color = "#fff";
      e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
    }
  };
  const onLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isPrimary) {
      e.currentTarget.style.background = "rgba(232,197,114,0.12)";
      e.currentTarget.style.borderColor = "rgba(232,197,114,0.35)";
    } else {
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = "rgba(255,255,255,0.75)";
      e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
    }
  };

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>}
        {label}
        <span style={{ fontSize: 11, opacity: 0.7 }}>↗</span>
      </a>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>}
      {label}
      <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
    </Link>
  );
}
