-- ──────────────────────────────────────────────────────────────────
-- Migration 065: carving_items.claim_batch_id — group transfer claims
-- ──────────────────────────────────────────────────────────────────
-- Daksh: the Slab Transfer page used to lock the runner to one
-- active claim at a time (real-world: one slab, one crane move).
-- Daksh is upgrading the workflow — runners now use a truck and
-- pick up to 10 slabs in a single run. We need to:
--
--   1. Allow claiming up to 10 carving_items in one click.
--   2. Group those 10 visually on the runner's "Claimed by me"
--      section so the truck-load reads as one batch.
--
-- New column claim_batch_id (UUID NULL) stamps every slab in the
-- same claim with the same id. Single-slab claims still get a
-- batch id (a group of 1) so the UI rendering is uniform.
--
-- Partial index covers the "active batch" lookup the UI needs
-- (claim_batch_id IS NOT NULL AND received_at_vendor_at IS NULL).
-- Pre-mig-065 claims have claim_batch_id NULL and render
-- individually — no backfill needed; ungrouped is fine for
-- legacy in-flight rows.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS claim_batch_id UUID NULL;

CREATE INDEX IF NOT EXISTS carving_items_claim_batch_open_idx
  ON public.carving_items (claim_batch_id)
  WHERE claim_batch_id IS NOT NULL AND received_at_vendor_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
