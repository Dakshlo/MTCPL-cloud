-- ──────────────────────────────────────────────────────────────────
-- 120 — email_snapshots.range
--
-- The dashboard "Refresh now" button can now fetch Today / Yesterday /
-- Last 3 days / Last 7 days. We store which window each snapshot used
-- so the card can show "showing: Last 7 days". Crons always store
-- 'today'. Backfills existing rows to 'today'.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.email_snapshots
  ADD COLUMN IF NOT EXISTS range TEXT NOT NULL DEFAULT 'today';

COMMIT;

-- Tell PostgREST to pick up the new column.
NOTIFY pgrst, 'reload schema';

-- Rollback:
--   ALTER TABLE public.email_snapshots DROP COLUMN IF EXISTS range;
