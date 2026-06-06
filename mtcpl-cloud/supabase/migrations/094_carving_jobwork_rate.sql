-- Migration 094 — Outsource jobwork rate snapshot on carving_items
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- Outsource/Jobwork carving jobs carry a per-CFT or per-SFT rate so an
-- approved job can produce a challan/invoice to pay the vendor. We
-- snapshot the rate, its unit, and the frozen amount on the carving_items
-- row so later rate-table or dimension edits never change what we agreed
-- to pay.
--
-- SAFETY: additive only — three nullable columns + one CHECK on the unit.
-- Idempotent (ADD COLUMN IF NOT EXISTS + DO-block constraint). CNC rows
-- simply leave these NULL; zero behaviour change for CNC.

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS jobwork_rate   NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS jobwork_unit   TEXT NULL,
  ADD COLUMN IF NOT EXISTS jobwork_amount NUMERIC(14,2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'carving_items_jobwork_unit_chk'
  ) THEN
    ALTER TABLE public.carving_items
      ADD CONSTRAINT carving_items_jobwork_unit_chk
      CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft', 'sft'));
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.carving_items DROP CONSTRAINT IF EXISTS carving_items_jobwork_unit_chk;
--   ALTER TABLE public.carving_items
--     DROP COLUMN IF EXISTS jobwork_rate,
--     DROP COLUMN IF EXISTS jobwork_unit,
--     DROP COLUMN IF EXISTS jobwork_amount;
