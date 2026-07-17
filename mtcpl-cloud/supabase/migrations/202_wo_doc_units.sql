-- 202: Work Order Document — allow NOS + TONNES units (Daksh, Jul 2026).
--
-- The unit column was locked to ('cft','sft') by a CHECK constraint (mig 105).
-- The team also bills some job-work per piece (nos) or by weight (tonnes), so
-- widen the allowed set. The per-item units inside the line_items JSONB are
-- unconstrained; this only governs the top-level column that mirrors item 1.

ALTER TABLE public.invoicing_work_order_docs
  DROP CONSTRAINT IF EXISTS invoicing_work_order_docs_unit_check;

ALTER TABLE public.invoicing_work_order_docs
  ADD CONSTRAINT invoicing_work_order_docs_unit_check
  CHECK (unit IN ('cft', 'sft', 'nos', 'tonnes'));

NOTIFY pgrst, 'reload schema';
