// ──────────────────────────────────────────────────────────────────
// Carving method vocabulary (mig 215) — Daksh, Aug 2026.
//
// One slab-level tag records the carving ROUTE decision that used to
// live only in Mohit's head:
//
//   'cnc'       → carve on our CNC machines
//   'outsource' → jobwork / outside carvers
//   'none'      → no carving — cut, then straight to dispatch
//   null        → "nil" — undecided / any (the default)
//
// This module is deliberately a PLAIN shared module (no "use client",
// no server imports) so both server actions and client components can
// import the same labels/colours/parser — and so importing it from a
// server component can never trip the client-reference-proxy trap.
// ──────────────────────────────────────────────────────────────────

export type CarvingMethod = "cnc" | "outsource" | "none";

export const CARVING_METHODS: CarvingMethod[] = ["cnc", "outsource", "none"];

/** Human label — null/undefined reads as the "any / undecided" nil. */
export function methodLabel(m: string | null | undefined): string {
  if (m === "cnc") return "CNC";
  if (m === "outsource") return "Outsource";
  if (m === "none") return "No carving";
  return "Nil — any";
}

/** Inline-style badge palette per method. Nil renders NO badge — the
 *  absence of a pill is itself the "undecided" signal. */
export const METHOD_BADGE: Record<CarvingMethod, { label: string; fg: string; bg: string; border: string }> = {
  cnc: { label: "CNC", fg: "#1d4ed8", bg: "rgba(37,99,235,0.10)", border: "rgba(37,99,235,0.35)" },
  outsource: { label: "OUTSOURCE", fg: "#92400e", bg: "rgba(180,83,9,0.10)", border: "rgba(180,83,9,0.35)" },
  none: { label: "NO CARVING", fg: "#0f766e", bg: "rgba(15,118,110,0.10)", border: "rgba(15,118,110,0.35)" },
};

/** Normalise any user/Excel input to a method (or null = nil).
 *
 *  Forgiving on purpose: the Excel column is optional and free-typed in
 *  practice, and an unrecognised value must NEVER reject a row — worst
 *  case the slab just stays undecided. */
export function parseCarvingMethodInput(raw: unknown): CarvingMethod | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s._-]+/g, " ");
  if (!s) return null;
  if (["cnc", "cnc machine", "machine"].includes(s)) return "cnc";
  if (["outsource", "outsourced", "out", "out source", "jobwork", "job work", "manual", "vendor"].includes(s)) return "outsource";
  if (["none", "no", "no carving", "nocarving", "no carve", "direct", "direct dispatch", "dispatch"].includes(s)) return "none";
  // "nil", "any", "undecided", typos … → nil.
  return null;
}
