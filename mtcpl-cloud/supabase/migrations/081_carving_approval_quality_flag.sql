-- ──────────────────────────────────────────────────────────────────
-- Mig 081 — Carving approval quality flag (structured Approve notes)
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 — the Approve flow had a single freeform "Notes
-- (optional)" textarea where the reviewer could type whatever. Daksh
-- wants this converted into a structured dropdown so we can track
-- common quality issues over time and (later) build a "vendor
-- quality patterns" analytics page without doing text mining on
-- review_notes.
--
-- The dropdown surfaces FOUR preset flags + an "Other" option that
-- re-opens the freeform textarea (kept on the review_notes column).
--
-- Preset flags:
--   carving_not_good   → "Approved but carving quality not great"
--   too_many_cracks    → "Approved but too many cracks"
--   color_variation    → "Approved but color variation"
--   minor_chips        → "Approved but minor chips / rough edges"
--   other              → freeform text in review_notes
--
-- Behaviour preservation:
--   * Column is NULLABLE — every existing row stays at NULL.
--   * Reviewer can still approve a slab with no flag (just close
--     the dropdown without picking). Captures the "slab was
--     perfect, nothing to flag" case.
--   * review_notes stays optional and is now ONLY populated when
--     'other' is selected (or when the legacy freeform path is
--     used by a stale client). Old data on review_notes is
--     untouched.
--   * rework + reject paths are not affected — they keep their
--     mandatory freeform reason textarea (the analytics value is
--     already structured via review_decision='rework_needed' /
--     'rejected', so a dropdown there would add no signal).

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_quality_flag TEXT NULL
    CHECK (
      review_quality_flag IS NULL
      OR review_quality_flag IN (
        'carving_not_good',
        'too_many_cracks',
        'color_variation',
        'minor_chips',
        'other'
      )
    );

-- Lightweight partial index for the planned analytics page. The
-- queries we anticipate:
--   "per vendor, count of each quality_flag in last N days"
--   "show me all carving_items with quality_flag = X"
-- Both filter on flag IS NOT NULL, so the partial index stays
-- compact (only flagged approvals are indexed; "perfect" approvals
-- are excluded). Sort by review_approved_at DESC so recency-bounded
-- queries are fast.
CREATE INDEX IF NOT EXISTS carving_items_quality_flag_idx
  ON public.carving_items (vendor_id, review_quality_flag, review_approved_at DESC)
  WHERE review_quality_flag IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- New column should exist + accept the six values (NULL + the
--   -- five explicit ones).
--   \d carving_items
--
--   -- Every existing carving_items row should have NULL on the new
--   -- field → byte-identical to pre-081 behaviour.
--   SELECT
--     COUNT(*) FILTER (WHERE review_quality_flag IS NULL)     AS no_flag,
--     COUNT(*) FILTER (WHERE review_quality_flag IS NOT NULL) AS flagged,
--     COUNT(*) total
--   FROM carving_items;
--
--   -- Spot-check the check constraint accepts NULL + each value.
--   -- (Don't run these for real — they're DRY examples of what
--   -- the constraint should permit and reject.)
--   -- ✓ NULL                             — allowed
--   -- ✓ 'carving_not_good'               — allowed
--   -- ✓ 'too_many_cracks'                — allowed
--   -- ✓ 'color_variation'                — allowed
--   -- ✓ 'minor_chips'                    — allowed
--   -- ✓ 'other'                          — allowed
--   -- ✗ 'something_unexpected'           — should reject
-- ──────────────────────────────────────────────────────────────────
