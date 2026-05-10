-- ──────────────────────────────────────────────────────────────────
-- Migration 022: restore gen_random_uuid() default on cnc_machines.id
--
-- Background
-- ──────────
-- Adding a new CNC machine via the vendor-edit modal was failing with
--
--   null value in column "id" of relation "cnc_machines"
--   violates not-null constraint
--
-- Daksh hit this on prod when trying to add 2-head and lathe machines
-- to a vendor. The app upsert intentionally OMITS `id` for new rows
-- (it only sends `id` for existing rows being updated) — so the
-- column is supposed to be filled by its default, gen_random_uuid().
-- The original definition in supabase/carving_phase_2_1.sql has that
-- default, but it's missing on the prod table — likely lost when an
-- earlier draft migration created the table without it.
--
-- Fix
-- ───
-- Set the default explicitly. Idempotent — re-running just sets it
-- to the same value. Doesn't touch existing rows.
--
-- Also sanity-checks pgcrypto is enabled so gen_random_uuid() exists
-- (it does on every Supabase project, but harmless to assert).
--
-- After running, NOTIFY pgrst so PostgREST sees any related schema
-- updates without a restart.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.cnc_machines
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

NOTIFY pgrst, 'reload schema';

COMMIT;
