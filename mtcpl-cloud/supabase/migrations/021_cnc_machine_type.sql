-- ──────────────────────────────────────────────────────────────────
-- Migration 021: cnc_machines.machine_type
--
-- The fleet has more than just one kind of CNC. Three types in play
-- right now:
--   • single_head  — default; one slab loaded at a time
--   • multi_head_2 — two heads; both run the SAME carving on
--                    IDENTICAL slabs in lockstep (mechanically
--                    coupled). Load action will validate matching
--                    slabs in a follow-up commit.
--   • lathe        — turning lathe; round/cylindrical work, single
--                    chuck, single piece at a time.
--
-- Stored as TEXT with a CHECK constraint rather than an enum so
-- new types can be added without DROP TYPE / CASCADE pain. Default
-- is single_head so every existing machine keeps its current
-- behaviour. head_count is derived in the app.
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.cnc_machines
  ADD COLUMN IF NOT EXISTS machine_type TEXT NOT NULL DEFAULT 'single_head';

-- Drop-then-add the CHECK so re-runs don't conflict with an old
-- constraint definition.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cnc_machines_machine_type_check') THEN
    ALTER TABLE public.cnc_machines DROP CONSTRAINT cnc_machines_machine_type_check;
  END IF;
  ALTER TABLE public.cnc_machines
    ADD CONSTRAINT cnc_machines_machine_type_check
    CHECK (machine_type IN ('single_head', 'multi_head_2', 'lathe'));
END $$;

-- Force PostgREST to refresh its schema cache so callers see the
-- new column immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;
