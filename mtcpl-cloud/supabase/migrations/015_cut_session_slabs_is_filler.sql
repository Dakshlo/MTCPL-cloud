-- 015: Mark "filler" / "extra" slabs in a cut session.
--
-- A slab is a "filler" when it was added to the plan via Fit-to-Fill
-- AFTER the operator's primary selection. It's something the team
-- chose to cut ahead because the block has leftover space, not
-- because there's a current order for it. Cutters need to see this
-- distinction at-a-glance so they know which slabs are
-- "for-now demand" vs "cut-ahead inventory".
--
-- The field flows: planning workbench → approvePlanAction →
-- cut_session_slabs row → cutting detail page → cutting print.
-- A purple tint + "EXTRA" badge renders on every visualisation.

BEGIN;

ALTER TABLE public.cut_session_slabs
  ADD COLUMN IF NOT EXISTS is_filler BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the rare future query "show all filler-cuts done
-- this week" so it doesn't full-scan the table.
CREATE INDEX IF NOT EXISTS cut_session_slabs_is_filler_idx
  ON public.cut_session_slabs(cut_session_block_id)
  WHERE is_filler = TRUE;

COMMIT;

-- Rollback:
-- ALTER TABLE public.cut_session_slabs DROP COLUMN IF EXISTS is_filler;
