-- ──────────────────────────────────────────────────────────────────
-- Migration 059: Bills — exclude cancelled rows from uniqueness
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Migration 058 follow-on (Daksh): the accountant can now cancel a
-- pending bill they entered with the wrong date / vendor invoice
-- number, and create a fresh bill. BUT — the existing UNIQUE
-- constraint on (bill_vendor_id, vendor_bill_no) treats the
-- cancelled row as live, so the recreate hits a duplicate-key
-- error.
--
-- Fix: swap the all-rows UNIQUE constraint for a partial UNIQUE
-- INDEX that only enforces uniqueness on bills whose status is
-- NOT 'cancelled'. Two non-cancelled bills still can't share the
-- same (vendor, vendor_bill_no) pair, but a cancelled bill no
-- longer blocks the slot.
--
-- Effect on existing data: zero. The current constraint already
-- holds (no duplicates exist among non-cancelled bills); the
-- partial index just narrows the scope going forward. Cancelled
-- rows keep their original vendor_bill_no — useful audit trail
-- ("we did issue T-2026-32 for INV-7 once, then cancelled it").
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Drop the broad uniqueness constraint.
ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_vendor_billno_unique;

-- 2. Add a partial UNIQUE index — only enforce when not cancelled.
-- Index naming follows the existing pattern (table_columns_purpose).
CREATE UNIQUE INDEX IF NOT EXISTS bills_vendor_billno_active_unique
  ON public.bills (bill_vendor_id, vendor_bill_no)
  WHERE status <> 'cancelled';

NOTIFY pgrst, 'reload schema';

COMMIT;
