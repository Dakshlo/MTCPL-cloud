/**
 * Shared types for the Personal Ledger module.
 *
 * Profile here is intentionally minimal — only the bits the module
 * actually reads (`id`, `role`). Extend it freely in your target
 * project; nothing else in the personal-ledger code touches these
 * extra fields.
 */

export type Profile = {
  /** Stable per-user identifier. Used as `owner_profile_id` on
   *  every personal-ledger row. UUID is the natural choice. */
  id: string;
  /** Optional role label. The permissions helper currently allows
   *  "developer" or "owner". Adjust src/lib/personal-ledger-permissions.ts
   *  to match the roles in your system, or relax it to "any signed-in
   *  user can use Personal Ledger". */
  role?: string;
};
