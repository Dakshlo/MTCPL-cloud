-- ──────────────────────────────────────────────────────────────────
-- Migration 089 — Up to 3 review photos per carving job
-- ──────────────────────────────────────────────────────────────────
-- Daksh (June 2026): the Carving Done review (Approve / Rework /
-- Reject) allowed ONE photo. Reviewers want to attach up to 3.
--
-- We add an array column `review_image_paths` (storage keys in the
-- carving_review_media private bucket) holding all 1-3 photos. The
-- existing single `review_image_path` (mig 080) is kept and always set
-- to the FIRST photo, so every surface that still reads the single
-- column keeps showing photo #1 with no change — backward compatible.
--
-- Historical rows: review_image_paths stays NULL; readers fall back to
-- [review_image_path] when present. Nothing to backfill.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_image_paths TEXT[] NULL;

-- ── ROLLBACK ────────────────────────────────────────────────────────
-- ALTER TABLE public.carving_items DROP COLUMN IF EXISTS review_image_paths;
