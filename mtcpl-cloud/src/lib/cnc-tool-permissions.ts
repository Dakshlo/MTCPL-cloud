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
 * ── Two screens, two jobs (Oct 2026) ────────────────────────
 *
 * There is no "which screen do you get" question any more. A logged-in
 * person is here to KEEP the store; everyone takes at the cupboard QR,
 * which needs no app login at all — just a code to their own phone.
 * That is why there are two gates here and not four:
 *
 *   canUseCncTools         may open the store screen
 *   canManageCncToolStore  may change the catalogue and correct a count
 *
 * Both return developer-only today. They are separate functions so that
 * opening the module up is an edit to THIS FILE plus a Settings card —
 * no page, action or table changes.
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

/** May this person change the catalogue (add a tool, set its warn line,
 *  archive it) and record a count correction? Narrower than opening the
 *  store, on purpose: a correction is the one write that can hide a
 *  loss. */
export function canManageCncToolStore(p: Pick<Profile, "role">): boolean {
  return p.role === "developer";
}
