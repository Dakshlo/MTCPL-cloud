import type { Profile } from "@/lib/types";

/**
 * CNC tool crib permission gates (Migration 227).
 *
 * ── v1 is DEVELOPER ONLY ───────────────────────────────────────────
 *
 * Daksh, Oct 2026: "for now we will make it for developer only; once
 * done we will make it for all users which are relevant."
 *
 * So the whole module is behind one role check while the cribs get
 * filled with the vendors' real tools and the flow is proven against
 * real stock. Nobody sees a half-built register.
 *
 * ── Why these two functions exist now, before they differ ──────────
 *
 * They return the same thing today. They are separate because they
 * answer different questions, and in v2 they diverge:
 *
 *   canUseCncTools        — may this person open a crib at all?
 *                           v2: + the vendor whose crib it is, + anyone
 *                           on the app_settings manager list.
 *   canManageCncToolCrib  — may this person add tools, set the low-stock
 *                           line, scrap and adjust?
 *                           v2: the manager list only. A vendor records
 *                           what leaves the crib; they do not get to
 *                           write off stock that has gone missing.
 *
 * Every page and every server action calls these, so opening the module
 * up is an edit to THIS FILE plus a Settings card — no page, action or
 * table changes. That is the whole reason the split is here on day one.
 *
 * ── The scoping rule that is NOT a role check ──────────────────────
 *
 * Which crib you are looking at is a separate question from whether you
 * may be here, and it is enforced in the database, not in TypeScript:
 * mig 227's composite foreign key makes a movement against another
 * vendor's tool impossible to insert. See cncToolVendorIdsFor below for
 * the shape v2 will use.
 */

/** May this person open the CNC tool crib at all? */
export function canUseCncTools(p: Pick<Profile, "role">): boolean {
  // v1: developer only.
  //
  // v2 adds:
  //   if (p.role === "vendor" && p.vendor_id) return true;
  //   if (managerIds.includes(p.id)) return true;
  return p.role === "developer";
}

/** May this person change the catalogue — add a tool, set its low-stock
 *  line, archive it — and record the movements that can hide a loss
 *  (scrap, adjust)? */
export function canManageCncToolCrib(p: Pick<Profile, "role">): boolean {
  // v1: developer only. In v2 this stays narrower than canUseCncTools.
  return p.role === "developer";
}

/** May this person see EVERY crib and switch between them?
 *
 *  In v1 the developer has no vendor of their own, so the switcher is
 *  the only way in. In v2 a vendor loses the switcher and is pinned to
 *  their own crib. */
export function canSwitchCncToolVendor(p: Pick<Profile, "role">): boolean {
  return p.role === "developer";
}

/**
 * Which cribs may this profile touch? `null` means "all of them".
 *
 * v1 always returns null because only the developer is here. The
 * function exists so that pages and actions already ASK the question —
 * when v2 pins a vendor to their own crib, the call sites do not change,
 * only the body of this function.
 *
 * Mig 077's `managed_vendor_ids` is the mechanism v2 will use for the
 * "Mohit covers Alkesh's shift" case, exactly as the carving cockpit
 * already does.
 */
export function cncToolVendorIdsFor(
  p: Pick<Profile, "role"> & { vendor_id?: string | null; managed_vendor_ids?: string[] | null },
): string[] | null {
  if (canSwitchCncToolVendor(p)) return null;
  const own = p.vendor_id ? [p.vendor_id] : [];
  return [...new Set([...own, ...(p.managed_vendor_ids ?? [])])];
}
