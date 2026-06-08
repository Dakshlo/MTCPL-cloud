-- Migration 107 — Work Order Document: optional extra detail field (Daksh, June 2026)
--
-- Adds an optional "description detail" column to the manual Work Order
-- Document generator (mig 105). The existing job_description stays as the
-- main job-work line; description_detail is a second, optional free-text
-- note that prints under it. The auto-generated code (MTCPL-WO-YYYY-0001)
-- continues to live in the existing job_work_no column — no schema change
-- needed for that (it's computed app-side at save time).
--
-- SAFETY: single additive ADD COLUMN IF NOT EXISTS. No other table touched,
-- no enum changes, no data conversion. Idempotent.

BEGIN;

ALTER TABLE public.invoicing_work_order_docs
  ADD COLUMN IF NOT EXISTS description_detail TEXT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.invoicing_work_order_docs DROP COLUMN IF EXISTS description_detail;
