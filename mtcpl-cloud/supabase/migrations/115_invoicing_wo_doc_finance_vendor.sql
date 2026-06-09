-- Migration 115 — Work Order Document: select vendor from Finance (Daksh, June 2026)
--
-- The Work Order Document now picks its vendor from the FINANCE vendor
-- master (public.bill_vendors) instead of its own little address book.
-- We snapshot the vendor's display fields onto the doc at save time so the
-- printed PDF stays frozen even if the vendor record later changes:
--
--   bill_vendor_id  — which finance vendor was selected (FK, informational).
--   vendor_gstin / vendor_category / vendor_email / vendor_mobile — snapshot.
--   (vendor name -> existing `vendor` column, address -> existing `address`.)
--
-- The old invoicing_wo_vendors address-book table is left UNTOUCHED (kept for
-- history); the app simply stops using it.
--
-- SAFETY: additive ADD COLUMN IF NOT EXISTS only. bill_vendors itself is NOT
-- modified by this migration. No enum changes, no data conversion. Idempotent.

BEGIN;

ALTER TABLE public.invoicing_work_order_docs
  ADD COLUMN IF NOT EXISTS bill_vendor_id  UUID NULL REFERENCES public.bill_vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_gstin    TEXT NULL,
  ADD COLUMN IF NOT EXISTS vendor_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS vendor_email    TEXT NULL,
  ADD COLUMN IF NOT EXISTS vendor_mobile   TEXT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.invoicing_work_order_docs
--     DROP COLUMN IF EXISTS bill_vendor_id,
--     DROP COLUMN IF EXISTS vendor_gstin,
--     DROP COLUMN IF EXISTS vendor_category,
--     DROP COLUMN IF EXISTS vendor_email,
--     DROP COLUMN IF EXISTS vendor_mobile;
