-- Migration 117 — Work Order Document: soft delete (Daksh, June 2026)
--
-- Deleting a saved Work Order Document now KEEPS the row (soft delete) so the
-- team can still see what was deleted (shown in red on the Saved-documents
-- page) instead of it vanishing. Accountant / Accountant★ can delete too
-- (gated in the action), not just owner/developer.
--
--   deleted_at — when it was deleted (NULL = live document).
--   deleted_by — who deleted it.
--
-- SAFETY: two additive ADD COLUMN IF NOT EXISTS. No data conversion, no other
-- table touched. Idempotent.

BEGIN;

ALTER TABLE public.invoicing_work_order_docs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.invoicing_work_order_docs
--     DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS deleted_by;
