// ──────────────────────────────────────────────────────────────────
// Messenger permissions (Mig 078)
// ──────────────────────────────────────────────────────────────────
// Daksh May 2026 — the messenger pilot is intentionally narrow:
// owner ↔ developer only. The pair was chosen because (a) they are
// both already on the system every day and (b) any roundtrip
// pathology (realtime drop, storage 403, signed-URL drift) will be
// caught immediately rather than waiting on a stencil-line user to
// notice. If the pilot survives a week we widen the helper to
// include team_head / senior_incharge.
//
// One helper, used in three places:
//   1. The topbar pill (renders only when canUseMessenger is true).
//   2. Every server action in /messenger/actions.ts (redirect to
//      default if the caller doesn't qualify — same shape as the
//      other gated actions in the app).
//   3. Recipient lookup at send time — the OTHER role is resolved
//      via `profile.role === "owner" ? "developer" : "owner"`,
//      which only makes sense if the caller's role is one of the
//      two. That invariant is enforced by the gate.
//
// Widening to more pairs later = update the role list here AND
// rework the recipient lookup (which today assumes a single peer).
// The schema is already generic (sender_id / recipient_id are plain
// profile refs) — only the helper + the lookup are pair-specific.
// ──────────────────────────────────────────────────────────────────

import type { Profile } from "@/lib/types";

export function canUseMessenger(
  p: Pick<Profile, "role"> | null | undefined,
): boolean {
  if (!p) return false;
  return p.role === "developer" || p.role === "owner";
}

/** Resolve the peer role for the messenger pilot pair. Throws if the
 *  caller is not a permitted messenger user — callers should gate on
 *  `canUseMessenger` first. Returns `"developer"` for an owner, and
 *  `"owner"` for a developer. The send actions use this to look up
 *  the (single) recipient profile at send time. */
export function peerRoleFor(role: Profile["role"]): "owner" | "developer" {
  if (role === "owner") return "developer";
  if (role === "developer") return "owner";
  throw new Error(
    `peerRoleFor: role "${role}" is not part of the messenger pilot pair`,
  );
}
