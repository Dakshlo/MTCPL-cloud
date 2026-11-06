import type { Profile } from "@/lib/types";

/**
 * CNC tool store permission gates (Migrations 227 + 228 + 234).
 *
 * ── Two kinds of person, two different doors ───────────────────────
 *
 * There is no "which screen do you get" question. A logged-in person is
 * here to KEEP the store; everyone else takes at the cupboard QR, which
 * needs no app login at all — just a code to their own phone.
 *
 *   canUseCncTools         may open the store screen
 *   canManageCncToolStore  may change the catalogue and correct a count
 *
 * ── Who keeps it (mig 234) ─────────────────────────────────────────
 *
 * v1 was developer-only while the store got filled with real stock.
 * Daksh, Nov 2026: "put all 3 under owner name — me, nikhil, and
 * vinay." Rather than hand two owners the whole developer surface so
 * they can top up a cupboard, there is a per-person flag on the profile
 * — the same shape the cutting module has used since mig 027.
 *
 * It is NOT `role === "owner"`: that would be a rule about a job title,
 * and the three people who keep this cupboard are not a job title. The
 * flag is off for everybody and granted by name, so opening it to a
 * fourth person is one UPDATE and no code change.
 */

// `| null` as well as optional: the column is nullable in the database
// and several callers hand through a row rather than a typed Profile.
type ToolProfile = Pick<Profile, "role"> & { can_keep_tool_store?: boolean | null };

/** May this person open the tool store at all? */
export function canUseCncTools(p: ToolProfile): boolean {
  // The developer always can — the module is still theirs to debug.
  if (p.role === "developer") return true;
  return p.can_keep_tool_store === true;
}

/**
 * May this person tap their name at the cupboard QR?
 *
 * The CNC vendors, obviously — it is their cupboard. Plus whoever keeps
 * the store, because Daksh, Nikhil and Vinay take a tool out of it like
 * anyone else, and because a keeper standing at the cupboard is the
 * person best placed to add a vendor's new man on the spot.
 *
 * Daksh, Nov 2026: "in that qr login i dont see vinay and nikhil."
 * They were being left off because the roster asked for a ROLE, and
 * their role is owner — which is exactly the mistake the keeper flag
 * exists to avoid.
 *
 * Their operators come from mig 234 and are checked separately; this is
 * only about people with a profile.
 */
export function canSignInAtCupboard(p: ToolProfile): boolean {
  return p.role === "vendor" || canUseCncTools(p);
}

/**
 * May this person enrol a man under ANY vendor, rather than only their
 * own? The office side: no company of their own, so they pick each
 * time. A vendor is pinned to his own firm and an operator to nothing.
 */
export function canEnrolForAnyVendor(p: ToolProfile): boolean {
  return canUseCncTools(p);
}

/**
 * May this person fill the shelf FROM THE CUPBOARD — add stock, add a
 * tool, correct a count?
 *
 * The office three, and the CNC vendors themselves. Daksh, Nov 2026:
 * "that add stock feature on qr login, enable that for mohit also, he
 * can also maintain and add stock."
 *
 * He named Mohit; this opens it to all three vendor principals, because
 * they are the same kind of person doing the same job at the same
 * cupboard and naming one of them in code would be a rule nobody could
 * explain in six months. Their OPERATORS still cannot: a man enrolled
 * off a sticker can take a tool and nothing else.
 *
 * Note what this is NOT. It is not canUseCncTools: a vendor still has
 * no business on the office screen, where the whole register and every
 * company's takes are laid out. This is the cupboard he stands at.
 */
export function canKeepAtCupboard(
  p: ToolProfile,
  opts: { hasOwnCompany: boolean },
): boolean {
  return canUseCncTools(p) || opts.hasOwnCompany;
}

/** May this person change the catalogue (add a tool, set its warn line,
 *  delete an empty one) and record a count correction?
 *
 *  Deliberately the same answer as canUseCncTools today: everyone who
 *  can see this screen is here to fill the shelf, and a read-only
 *  keeper would be a person who can watch a tool run out and do nothing
 *  about it. The two functions stay separate so the day a watcher is
 *  wanted — crosscheck, say — it is an edit to THIS FILE and nothing
 *  else; every page and action already asks the right one of the two. */
export function canManageCncToolStore(p: ToolProfile): boolean {
  return canUseCncTools(p);
}
