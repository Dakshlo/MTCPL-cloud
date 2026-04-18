-- 004_slab_requirements_batch_id.sql
--
-- Add batch_id to slab_requirements so slabs created in one "qty > 1" add
-- can be grouped for multi-select bulk edit / bulk delete in the UI.
--
-- Rules:
--   - Slabs added together share one UUID here.
--   - Slabs added one-at-a-time (qty = 1) keep batch_id = NULL — those are
--     singletons and are never multi-selectable.
--   - The server re-verifies the shared batch_id before performing any
--     bulk action, so the UI can never accidentally delete across batches.
--
-- Index is partial (only non-NULL values) to keep it small — the majority
-- of rows will be NULL since most slabs are added one-off.

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_slab_req_batch
  ON public.slab_requirements (batch_id)
  WHERE batch_id IS NOT NULL;

-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_slab_req_batch;
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS batch_id;
--   -- Batch grouping is lost; existing slabs are unaffected otherwise.
