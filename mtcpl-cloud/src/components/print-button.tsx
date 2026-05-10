"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Tiny client component for triggering window.print().
 *
 * Lives as its own file so server-rendered pages (which can't have
 * inline onClick handlers) can drop in a print trigger without
 * needing to convert the whole page to "use client". We hit a real
 * production breakage from inline handlers on server components, so
 * the rule is: any onClick goes through a small client component
 * like this one.
 */
export function PrintButton({
  children = "🖨 Print",
  className = "ghost-button",
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => window.print()}
    >
      {children}
    </button>
  );
}
