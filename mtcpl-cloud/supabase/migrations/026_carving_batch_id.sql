-- ──────────────────────────────────────────────────────────────────
-- Migration 026: carving_items.batch_id — group slabs assigned together
--
-- The carving head often assigns 2-4 slabs to the same vendor in one
-- go (most often 2 for a 2-head CNC pair). Today each slab becomes
-- its own carving_items row with no link back to the batch. This
-- migration adds a `batch_id` UUID that's shared across every slab
-- in a single multi-select assignment.
--
-- Downstream UI uses batch_id to:
--   - Colour-group slabs in the vendor cockpit Pending stock list
--   - Colour-group slabs in the transfer runner's Available list
--   - Highlight "these came together" so the vendor pairs them up
--
-- NULL means "this row was assigned individually" — backward
-- compatible with every existing carving_items row.
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Speeds up "find slabs in the same batch" queries on the vendor
-- cockpit + transfer page. Only carving_assigned + carving_in_progress
-- rows matter — completed slabs don't need the batch grouping.
CREATE INDEX IF NOT EXISTS carving_items_batch_id_idx
  ON public.carving_items (batch_id)
  WHERE batch_id IS NOT NULL
    AND status IN ('carving_assigned', 'carving_in_progress');

NOTIFY pgrst, 'reload schema';

COMMIT;
