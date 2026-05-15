/**
 * Canonical slab_requirements.status buckets.
 *
 * Background — the MT-B-246 bug (Daksh, May 2026):
 *   Several pages used `WHERE status = 'cut_done'` to fetch "slabs that
 *   came out of this block." That broke any time a slab moved on to
 *   carving / dispatch / got rejected as broken — the slab silently
 *   dropped from the source-block view. Block X showed 3 slabs cut,
 *   but actually produced 8. Recovery % was halved.
 *
 * Rule of thumb:
 *   • If the question is "where can this slab go NEXT?" — filter to a
 *     specific status (carving page wants `cut_done`, dispatch wants
 *     `completed`, etc).
 *   • If the question is "what came out of this block?" or "what was
 *     produced?" — use POST_CUT_STATUSES so a slab keeps being credited
 *     to its source block no matter where it currently sits.
 *
 * Lifecycle (slab_requirements.status):
 *
 *   open ── planned (in a cut plan)
 *     │
 *     └── cut_done ── carving_assigned ── carving_in_progress
 *                                              │
 *                                              ├── completed ── dispatched
 *                                              │
 *                                              └── rejected  (broken during carving)
 *
 * `rejected` IS post-cut — the slab physically existed, it just got
 * destroyed. Block journey, recovery %, and verification views must
 * still credit the source block for cutting it.
 */

/** Statuses meaning "a slab requirement that hasn't been physically cut yet." */
export const PRE_CUT_STATUSES = ["open", "planned"] as const;

/** Statuses meaning "a slab that was physically produced from a block." */
export const POST_CUT_STATUSES = [
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "completed",
  "dispatched",
  "rejected",
] as const;

export type PostCutStatus = (typeof POST_CUT_STATUSES)[number];
export type PreCutStatus = (typeof PRE_CUT_STATUSES)[number];
