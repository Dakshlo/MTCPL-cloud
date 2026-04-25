-- Cross-block slab transfer support — adds a "needs_reprint" flag on
-- cut_session_blocks so when slabs are claimed away from a donor block's
-- plan (and removed from its layout.placed[]), the donor operator gets
-- a banner telling them their plan changed and to reprint before cutting.
--
-- See plan: cross-block slab transfer.
-- Idempotent — running twice is a no-op.

BEGIN;

ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS needs_reprint BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reprint_reason TEXT;

-- Partial index — most rows have needs_reprint=FALSE, so we only index the
-- (rare) TRUE rows. Cheap "any donor blocks need reprint?" queries.
CREATE INDEX IF NOT EXISTS cut_session_blocks_needs_reprint_idx
  ON public.cut_session_blocks(updated_at DESC)
  WHERE needs_reprint = TRUE;

COMMIT;
