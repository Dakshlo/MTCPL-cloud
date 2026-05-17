-- ──────────────────────────────────────────────────────────────────
-- Migration 059: Bills — exclude cancelled rows from uniqueness
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Migration 058 follow-on (Daksh): the accountant can now cancel a
-- pending bill they entered with the wrong date / vendor invoice
-- number, and create a fresh bill. BUT — the existing UNIQUE
-- index treats cancelled rows as live, so the recreate hits a
-- duplicate-key error.
--
-- The current uniqueness is `bills_vendor_billno_fy_unique` on
-- (bill_vendor_id, vendor_bill_no_normalized, financial_year) —
-- established in mig 039, refined in mig 043. (My first cut of
-- this migration targeted the long-dropped mig 028 constraint by
-- mistake, then created a stricter index that conflicted with
-- legitimate cross-FY duplicates. This version preserves the same
-- shape and just adds the partial filter.)
--
-- Fix: drop the existing index, recreate it with the same column
-- list plus a partial filter `WHERE status <> 'cancelled'`. Two
-- live bills in the same FY still can't share normalized number;
-- cancelled bills step aside.
--
-- Effect on existing data: zero. The data already satisfies the
-- existing uniqueness; the partial filter only relaxes things
-- going forward (lets us re-use a number that a cancelled bill
-- once held).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- Drop the broad uniqueness index (mig 043's version).
DROP INDEX IF EXISTS public.bills_vendor_billno_fy_unique;

-- Recreate with the same three-column shape + the partial filter
-- so cancelled rows don't occupy slots in the unique space.
CREATE UNIQUE INDEX IF NOT EXISTS bills_vendor_billno_fy_active_unique
  ON public.bills (bill_vendor_id, vendor_bill_no_normalized, financial_year)
  WHERE status <> 'cancelled';

NOTIFY pgrst, 'reload schema';

COMMIT;
