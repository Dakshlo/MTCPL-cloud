import type { AppRole, Profile } from "@/lib/types";

/**
 * Parkota Pillar Tracker access gate (Daksh, Jul 2026).
 *
 * The tracker is the Baba Mastnath parkota board — 645 pillars, each moving
 * through made / fixed, plus parts and stock. It is not a general production
 * surface: only the people who actually run that site update it.
 *
 * Spec: "only for developer, owner, senior incharge and carving head".
 *
 * This one list is the single source of truth and is used in three places, all
 * server-side:
 *   1. middleware.ts  — gates the ~20 MB static shell at /parkota
 *   2. /api/parkota/state — gates every read and write of the live state
 *   3. temples/page.tsx — decides whether the long-press entry point is wired
 *      onto the Baba Mastnath card at all
 *
 * Kept as a plain (non-"use client") module on purpose: PARKOTA_ROLES is a
 * runtime value imported by server components, and importing a value out of a
 * client module turns it into a client-reference proxy that throws at runtime.
 */
export const PARKOTA_ROLES: readonly AppRole[] = ["developer", "owner", "senior_incharge", "carving_head"];

export function canUseParkota(p: Pick<Profile, "role"> | { role: string } | null | undefined): boolean {
  if (!p) return false;
  return (PARKOTA_ROLES as readonly string[]).includes(p.role);
}

/**
 * The tracker covers exactly one temple. Matched on a substring rather than the
 * full name because temple names are denormalised across the app and can be
 * renamed (mig 161 rename_temple), which would otherwise silently detach the
 * entry point from the card.
 */
export const PARKOTA_TEMPLE_MATCH = "BABA MASTNATH";

export function isParkotaTemple(templeName: string | null | undefined): boolean {
  return !!templeName && templeName.toUpperCase().includes(PARKOTA_TEMPLE_MATCH);
}
