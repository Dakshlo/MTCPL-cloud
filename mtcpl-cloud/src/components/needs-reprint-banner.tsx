/**
 * Banner shown at the top of /cutting/[id] when a slab was claimed
 * away from this block's plan by another cutting block. The donor
 * operator's plan is now stale — they should reprint before continuing.
 *
 * Server-side action `acknowledgeReprintAction` clears the flag once
 * the operator has either reprinted (and clicked the link) or
 * dismissed the banner (because they understand the change and don't
 * need a fresh paper copy).
 *
 * Lives at src/components because the cutting [id] route is a server
 * component and this is a typical reusable client widget.
 */

import Link from "next/link";
import { acknowledgeReprintAction } from "@/app/(app)/cutting/actions";

export function NeedsReprintBanner({
  blockId,
  reason,
  printHref,
}: {
  blockId: string;
  reason: string | null;
  printHref: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginBottom: 16,
        padding: "12px 16px",
        background: "rgba(180,83,9,0.08)",
        border: "1px solid rgba(180,83,9,0.4)",
        borderLeft: "4px solid #b45309",
        borderRadius: 8,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, marginTop: 2 }}>⚠️</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginBottom: 3 }}>
          Plan modified — reprint before cutting
        </div>
        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
          {reason ?? "Some slabs from this block's plan were claimed by another cutting block."}{" "}
          The 3D layout below has been updated. Reprint the plan or acknowledge to dismiss this notice.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <Link
          href={printHref}
          target="_blank"
          rel="noopener noreferrer"
          className="ghost-button"
          style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          🖨 Reprint
        </Link>
        <form action={acknowledgeReprintAction} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={blockId} />
          <button
            type="submit"
            className="primary-button"
            style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
          >
            ✓ Acknowledge
          </button>
        </form>
      </div>
    </div>
  );
}
