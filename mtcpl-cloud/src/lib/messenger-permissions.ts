// ──────────────────────────────────────────────────────────────────
// Messenger permissions (Mig 078)
// ──────────────────────────────────────────────────────────────────
// Daksh May 2026 — the messenger pilot is intentionally narrow:
// owner ↔ developer only. The pair was chosen because (a) they are
// both already on the system every day and (b) any roundtrip
// pathology (realtime drop, storage 403, signed-URL drift) will be
// caught immediately rather than waiting on a stencil-line user to
// notice.
//
// Round-2 follow-on (Daksh, same week): the pilot needs to handle
// MORE THAN ONE owner — there are multiple "owner" rows (Naresh and
// Nikhil at minimum), and they should be able to chat with each
// other AND with the developer. So the gate widened from "exactly
// two roles, one of each" to "anyone whose role is owner OR
// developer, and they can message anyone else in that same pool."
// Conceptually identical to a small WhatsApp roster.
//
// Two helpers:
//   • canUseMessenger — whether the user gets the 💬 pill at all.
//     Used by the topbar mount AND every server action.
//   • isPermittedMessengerRole — whether a CANDIDATE peer (resolved
//     from a recipient_id in a FormData) qualifies to be on the
//     receiving end of a message. Same set as canUseMessenger; the
//     name is just clearer at the call site.
//
// Widening to more roles later = update the role set in BOTH
// helpers (or refactor them to share a single PERMITTED_ROLES
// constant). The actions deliberately validate the recipient
// against this list at send time so a tampered client can't aim a
// message at a slab-entry user's profile.
// ──────────────────────────────────────────────────────────────────

import type { AppRole, Profile } from "@/lib/types";

const PERMITTED_ROLES: ReadonlySet<AppRole> = new Set<AppRole>([
  "developer",
  "owner",
]);

export function canUseMessenger(
  p: Pick<Profile, "role"> | null | undefined,
): boolean {
  if (!p) return false;
  return PERMITTED_ROLES.has(p.role);
}

/** Does `role` qualify to receive messenger messages? Same set as
 *  `canUseMessenger` — used by the server actions to validate the
 *  recipient_id the client supplies. */
export function isPermittedMessengerRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return PERMITTED_ROLES.has(role as AppRole);
}
