import type { CSSProperties } from "react";

/**
 * Daksh June 2026 — the slab "component" hierarchy, rendered as a compact
 * stack: Category 1 (section) › Category 2 (element) › 🏷 Label › Description
 * › + Additional. Each line shows ONLY when that field has a non-empty value,
 * and the whole block renders nothing when every field is empty — so older
 * slabs that predate the Category 1/2 columns just show the levels they have.
 *
 * Extracted from the original Unassigned-carving card so the exact same
 * presentation can be reused across carving job cards, the job detail peek,
 * dispatch cards, the vendor cockpit rows and the Find-ID result panel.
 *
 * Pure presentational (no hooks) so it is safe in both server and client
 * components.
 */
export function SlabComponentDetail({
  section,
  element,
  label,
  description,
  additional,
  style,
}: {
  section?: string | null;
  element?: string | null;
  label?: string | null;
  description?: string | null;
  additional?: string | null;
  /** Optional wrapper style override (e.g. larger gap on detail panels). */
  style?: CSSProperties;
}) {
  const c1 = section?.trim();
  const c2 = element?.trim();
  const lbl = label?.trim();
  const desc = description?.trim();
  const add = additional?.trim();
  if (!c1 && !c2 && !lbl && !desc && !add) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, ...style }}>
      {c1 && (
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={c1}
        >
          {c1}
        </div>
      )}
      {c2 && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={c2}
        >
          › {c2}
        </div>
      )}
      {lbl && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text)" }}>🏷 {lbl}</div>
      )}
      {desc && <div style={{ fontSize: 10, color: "var(--muted)" }}>{desc}</div>}
      {add && (
        <div style={{ fontSize: 9.5, fontStyle: "italic", color: "var(--muted-light)" }}>
          + {add}
        </div>
      )}
    </div>
  );
}
