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
 * Daksh, Nov 2026: "if a vendor's operator wants access they will click
 * on their respective vendor — eg Vivek — then his operator will click
 * on Vivek and take the OTP from Vivek. No separate thing for them."
 * So this is now the whole list: there is nobody else who can sign in
 * at a cupboard. See mig 234's note in lib/cnc-tool-operators.ts.
 */
export function canSignInAtCupboard(p: ToolProfile): boolean {
  return p.role === "vendor" || canUseCncTools(p);
}

/**
 * May this person fill the shelf FROM THE CUPBOARD — add stock, add a
 * tool, correct a count?
 *
 * THE OFFICE THREE ONLY. Daksh, Nov 2026: "there are some features like
 * developer and owner which Mohit also has, like add stock and fix
 * count. Remove that from Mohit's account for mobile — only developer
 * and owner can have these options on long press, others will only have
 * take pcs. And for vendors remove that add item also."
 *
 * This REVERSES his own earlier instruction, which this function used to
 * quote: "that add stock feature on qr login, enable that for Mohit
 * also, he can also maintain and add stock." It ran that way for a
 * fortnight and he has decided against it, so the reason is worth
 * writing down rather than just the rule.
 *
 * What a vendor could do with it is the whole argument. Add stock and
 * fix count are the two writes that move the shelf WITHOUT anybody
 * taking anything — the only two places where a number can change with
 * no corresponding tool in a man's hands. Whoever holds them can cover
 * a shortfall. Keeping them with the people who answer for the cupboard
 * and not the people who draw from it is the ordinary separation, and
 * it costs a vendor nothing: he can still take, and still account for
 * what he took.
 *
 * `opts` is kept in the signature deliberately. Every caller already
 * computes it and the day this opens up again it will be the thing that
 * decides, so the argument stays rather than being deleted and
 * re-plumbed through four files.
 */
export function canKeepAtCupboard(
  p: ToolProfile,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts: { hasOwnCompany: boolean },
): boolean {
  return canUseCncTools(p);
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

/**
 * May this person scan a supplier bill and post it to the shelf
 * (mig 237)?
 *
 * DEVELOPER ONLY, on purpose, and only for now. Daksh, Nov 2026: "for
 * now make that for my account, developer, in dashboard — not QR phone.
 * After this works fine we will remove the add item from Mohit's phone
 * QR."
 *
 * So this is the same shape the whole module started in: one pair of
 * hands while the matcher learns what the suppliers actually print, and
 * then it opens up. Widening it is one line here — canUseCncTools(p) —
 * once a few real bills have gone through without a surprise.
 *
 * Kept deliberately narrower than canManageCncToolStore, because this
 * is the one door that can create catalogue entries in bulk from a
 * photograph. Everything else on the screen touches one tool at a time.
 */
export function canScanToolBills(p: ToolProfile): boolean {
  return p.role === "developer";
}
