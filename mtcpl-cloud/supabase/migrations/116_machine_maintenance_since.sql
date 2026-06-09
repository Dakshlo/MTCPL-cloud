-- Migration 116 — Maintenance: track how long a machine has been down (Daksh, June 2026)
--
-- The repair-ticket workflow is being shelved for now; the department becomes
-- a simple Working / Under-maintenance board the owner can scan. To show "how
-- long has it been under maintenance", we stamp a timestamp when a machine is
-- marked under_maintenance and clear it when it goes back to working/retired.
--
--   under_maintenance_since — TIMESTAMPTZ, set on → under_maintenance,
--                             NULL when working/retired.
--
-- Backfill: any machine currently under_maintenance with no stamp gets its
-- last-updated time (best available estimate) so its timer isn't blank.
--
-- SAFETY: single additive ADD COLUMN IF NOT EXISTS + a one-time backfill that
-- only touches rows already in under_maintenance. The ticket tables
-- (machine_maintenance_tickets etc.) are LEFT INTACT — just unused by the UI
-- for now. No enum changes. Idempotent.

BEGIN;

ALTER TABLE public.company_machines
  ADD COLUMN IF NOT EXISTS under_maintenance_since TIMESTAMPTZ NULL;

UPDATE public.company_machines
   SET under_maintenance_since = COALESCE(updated_at, NOW())
 WHERE status = 'under_maintenance'
   AND under_maintenance_since IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.company_machines DROP COLUMN IF EXISTS under_maintenance_since;
