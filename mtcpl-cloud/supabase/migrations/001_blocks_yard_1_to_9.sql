-- 001_blocks_yard_1_to_9.sql
--
-- Expand the blocks.yard CHECK constraint from the original (1, 2, 3) up to
-- (1 .. 9) so we can record:
--
--   1-6  : legacy MTCPL main-facility yards
--   7,8  : RIICO facility (separate physical location)
--   9    : Open Yard (MTCPL, outdoor overflow)
--
-- The UI source of truth is `src/lib/yards.ts` — keep that list in sync with
-- the CHECK here any time we add or remove a yard.
--
-- Applied: session on ~2026-04-18 (yard 1..6), then widened to 1..8 for RIICO,
-- then widened to 1..9 when Open Yard was added. This file captures the
-- final state.

ALTER TABLE public.blocks
  DROP CONSTRAINT IF EXISTS blocks_yard_check;

ALTER TABLE public.blocks
  ADD  CONSTRAINT blocks_yard_check
  CHECK (yard IN (1, 2, 3, 4, 5, 6, 7, 8, 9));

-- ROLLBACK:
--   ALTER TABLE public.blocks DROP CONSTRAINT blocks_yard_check;
--   ALTER TABLE public.blocks
--     ADD CONSTRAINT blocks_yard_check CHECK (yard IN (1, 2, 3));
--   -- NOTE: rollback will fail if any existing block has yard > 3.
