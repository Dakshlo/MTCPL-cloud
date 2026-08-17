-- Migration 219 — "Settle" an already-paid bill. (Daksh, Aug 2026)
--
-- WHAT / WHY
-- Some bills were paid to the vendor OUTSIDE this software (cash, an
-- old cheque, a direct transfer nobody recorded). They sit in Due Bills
-- forever showing an outstanding that isn't real. Settlement lets the
-- OWNER or DEVELOPER clear that outstanding — fully or partially —
-- against a MANDATORY written reason.
--
-- A settlement is NOT a new payment: no money leaves the bank now. It
-- records money that already left. So the row is kept out of every cash
-- report (HDFC CSV, Final Audit, daily/MTD payment totals, the payment
-- planner) and shown only on the bill itself + its timeline, where the
-- date and the person who settled it are what matter.
--
-- MECHANISM (deliberately identical to mig 085's debit settlement and
-- mig 073's advance application — a proven, reversible pattern)
-- Insert a synthetic, pre-paid bill_payments row on the bill tagged
-- is_settlement=TRUE. The existing recalc_bill_amount_paid trigger
-- (mig 028) then drops amount_outstanding for free and flips the bill
-- to 'fully_paid' when it reaches zero. Reversal = soft-cancel that
-- synthetic row (status='cancelled'); the same trigger restores the
-- outstanding, because it only sums status='paid' rows (mig 052).
--
-- SAFETY: purely additive. Four nullable/defaulted columns on
-- bill_payments. This migration mutates NO existing row, changes no
-- existing column, and deletes nothing. Every runtime effect happens
-- later, is written by an owner/dev with a reason, and is reversible.
--
-- ROLLBACK
--   ALTER TABLE public.bill_payments
--     DROP COLUMN IF EXISTS is_settlement,
--     DROP COLUMN IF EXISTS settlement_reason,
--     DROP COLUMN IF EXISTS settlement_reversed_at,
--     DROP COLUMN IF EXISTS settlement_reversed_by,
--     DROP COLUMN IF EXISTS settlement_reverse_reason;
--   DROP INDEX IF EXISTS idx_bill_payments_settlement;

BEGIN;

ALTER TABLE public.bill_payments
  -- The synthetic row marker. Every cash report filters on this.
  ADD COLUMN IF NOT EXISTS is_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  -- Why this bill was settled outside the software. Mandatory in the
  -- app; nullable here so the column can be added without a rewrite.
  ADD COLUMN IF NOT EXISTS settlement_reason TEXT NULL,
  -- Reversal trail (owner/dev can undo a mistaken settlement).
  ADD COLUMN IF NOT EXISTS settlement_reversed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS settlement_reversed_by UUID NULL,
  ADD COLUMN IF NOT EXISTS settlement_reverse_reason TEXT NULL;

-- Settlements are a tiny minority of rows — a partial index keeps the
-- "is this bill settled?" lookups cheap without bloating the table.
CREATE INDEX IF NOT EXISTS idx_bill_payments_settlement
  ON public.bill_payments (bill_id)
  WHERE is_settlement = TRUE;

COMMENT ON COLUMN public.bill_payments.is_settlement IS
  'TRUE = synthetic row clearing an outstanding for a bill already paid outside the software (mig 219). Not a bank payment: excluded from HDFC export, Final Audit and all cash totals.';

NOTIFY pgrst, 'reload schema';

COMMIT;
