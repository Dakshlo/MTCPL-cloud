/**
 * Banner shown at the top of /cutting/[id] when a slab was claimed
 * away from this block's plan by another cutting block. The donor
 * operator's plan is now stale — they should reprint before continuing.
 *
 * Sized big and red on purpose: the small amber version was getting
 * skipped on the floor. Operators need to see this BEFORE picking up
 * the saw.
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
      role="alert"
      aria-live="assertive"
      style={{
        marginBottom: 18,
        padding: "16px 20px",
        background:
          "linear-gradient(90deg, rgba(220,38,38,0.18) 0%, rgba(220,38,38,0.10) 50%, rgba(220,38,38,0.18) 100%)",
        border: "2px solid #dc2626",
        borderLeft: "8px solid #b91c1c",
        borderRadius: 10,
        boxShadow: "0 4px 14px rgba(220,38,38,0.18)",
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 36, lineHeight: 1, marginTop: 2 }}>🚨</span>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#b91c1c",
            marginBottom: 4,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
          }}
        >
          PLAN MODIFIED — REPRINT BEFORE CUTTING
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1a1a1a",
            lineHeight: 1.45,
            marginBottom: 4,
          }}
        >
          फिर से print करें — plan बदल गया है
        </div>
        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
          {reason ?? "Some slabs from this block's plan were claimed by another cutting block."}
          {" "}
          The 3D layout below has been updated. Print the new plan, or click Acknowledge if you've
          already noted the change.
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
        <Link
          href={printHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: "10px 18px",
            textDecoration: "none",
            background: "#fff",
            color: "#b91c1c",
            border: "2px solid #b91c1c",
            borderRadius: 7,
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
          }}
        >
          🖨 Reprint plan
        </Link>
        <form action={acknowledgeReprintAction} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={blockId} />
          <button
            type="submit"
            style={{
              fontSize: 13,
              fontWeight: 700,
              padding: "10px 16px",
              background: "transparent",
              color: "#b91c1c",
              border: "1.5px solid rgba(185,28,28,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✓ Acknowledge
          </button>
        </form>
      </div>
    </div>
  );
}
