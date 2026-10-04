import type { Profile } from "@/lib/types";

/**
 * CNC tool store permission gates (Migrations 227 + 228).
 *
 * ── v1 is DEVELOPER ONLY ───────────────────────────────────────────
 *
 * Daksh, Oct 2026: "for now we will make it for developer only; once
 * done we will make it for all users which are relevant."
 *
 * So the whole module is behind one role check while the store gets
 * filled with the real tools and the flow is proven against real
 * stock. Nobody sees a half-built register.
 *
 * ── Two screens, one module ─────────────────────────────────
 *
 * canSeeCncToolMaster is the dividing line. It decides WHICH SCREEN a
 * person gets, not merely what they may click:
 *
 *   master  → the store: every tool, every vendor's draw, the whole
 *             register. For the owner and for Daksh.
 *   vendor  → a big Take button and their own recent takings, with the
 *             store's stock tucked behind one more tap. Daksh was
 *             explicit that a vendor's job is NOT to study stock.
 *
 * canManageCncToolStore is narrower still: adding tools and the two
 * movements that can hide a loss (scrap, fix count). Taking is open to
 * anyone who may be here; writing stock off is not.
 *
 * All three return developer-only today. They are separate functions so
 * that opening the module up is an edit to THIS FILE plus a Settings
 * card — no page, action or table changes.
 */

/** May this person open the tool store at all? */
export function canUseCncTools(p: Pick<Profile, "role">): boolean {
  // v1: developer only.
  //
  // v2 adds:
  //   if (p.role === "vendor" && p.vendor_id) return true;   // their own view
  //   if (managerIds.includes(p.id)) return true;            // master view
  return p.role === "developer";
}

/**
 * May this person see the MASTER view — the whole store, every tool,
 * every vendor's draw, and the full register?
 *
 * Daksh: "there will be a master view for me or owner or whatever role
 * we decide — they will see info, but the vendor will see their recent
 * items taken." So this is the dividing line between the two screens,
 * not a nice-to-have.
 */
export function canSeeCncToolMaster(p: Pick<Profile, "role">): boolean {
  return p.role === "developer";
}

/** May this person change the catalogue (add a tool, set its warn line,
 *  archive it) and record the movements that can hide a loss — scrap
 *  and fix-count? Narrower than taking, on purpose. */
export function canManageCncToolStore(p: Pick<Profile, "role">): boolean {
  return p.role === "developer";
}

/**
 * Which vendor is this person taking FOR?
 *
 * A vendor takes for themselves and nothing else. Someone with the
 * master view is taking on behalf of whichever vendor the screen is
 * showing, so the caller passes that in and this only vets it.
 *
 * Returns null when the person may not take for that vendor at all.
 */
export function takingVendorFor(
  p: Pick<Profile, "role"> & { vendor_id?: string | null; managed_vendor_ids?: string[] | null },
  requested: string | null,
): string | null {
  if (canSeeCncToolMaster(p)) return requested; // master takes for anyone
  const allowed = new Set(
    [p.vendor_id, ...(p.managed_vendor_ids ?? [])].filter(Boolean) as string[],
  );
  if (requested && allowed.has(requested)) return requested;
  return p.vendor_id ?? null;
}
