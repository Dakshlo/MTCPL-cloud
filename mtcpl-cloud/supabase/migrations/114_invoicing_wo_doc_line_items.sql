-- Migration 114 — Work Order Document: multiple line-item groups + GST note (Daksh, June 2026)
--
-- The manual Work Order Document (mig 105) printed a single line item
-- (one description + one unit/quantity/rate/total). The owner wants up to
-- FOUR line-item groups on one document — each with its own description and
-- its own unit/quantity/rate/total — plus a standard note that the amounts
-- are exclusive of GST.
--
--   line_items     — JSONB array (1..4) of
--                    { description, unit('cft'|'sft'), quantity, rate, total }.
--                    The legacy job_description / unit / quantity / rate / total
--                    columns are kept populated from the FIRST item (and
--                    `total` holds the GRAND total) so old readers + the saved-
--                    documents list keep working. Rows created before this
--                    migration have line_items = NULL; the PDF route falls back
--                    to building a single item from the legacy columns.
--   gst_exclusive  — when TRUE, the PDF prints "amounts exclusive of GST".
--
-- SAFETY: two additive ADD COLUMN IF NOT EXISTS. No other table touched,
-- no enum changes, no data conversion. Idempotent.

BEGIN;

ALTER TABLE public.invoicing_work_order_docs
  ADD COLUMN IF NOT EXISTS line_items    JSONB   NULL,
  ADD COLUMN IF NOT EXISTS gst_exclusive BOOLEAN NOT NULL DEFAULT true;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.invoicing_work_order_docs
--     DROP COLUMN IF EXISTS line_items,
--     DROP COLUMN IF EXISTS gst_exclusive;
