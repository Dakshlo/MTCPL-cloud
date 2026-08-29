-- ──────────────────────────────────────────────────────────────────
-- Migration 225: Hindi digest on the email snapshot
-- ──────────────────────────────────────────────────────────────────
-- Companion to mig 224 (which added the per-user language toggle).
-- The per-email Hindi lives inside the existing `items` jsonb and
-- needed no schema change; the batch digest is its own column, so it
-- needs one.
--
-- NULL on every existing row — those snapshots were written before the
-- Hindi pass and the panel falls back to English for them, which is
-- what they showed anyway. The next cron (5 am / 2 pm IST) fills it.
--
-- Rollback:
--   ALTER TABLE public.email_snapshots DROP COLUMN IF EXISTS overview_hi;
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.email_snapshots
  ADD COLUMN IF NOT EXISTS overview_hi TEXT NULL;

COMMENT ON COLUMN public.email_snapshots.overview_hi IS
  'Mig 225 — the batch digest in Hindi. NULL on pre-225 rows; the panel falls back to `overview`.';

NOTIFY pgrst, 'reload schema';

COMMIT;
