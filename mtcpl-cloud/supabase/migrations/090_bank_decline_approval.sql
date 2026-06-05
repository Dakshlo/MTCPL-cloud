-- Migration 090 — Bank-decline owner approval (Daksh, June 2026)
--
-- WHAT / WHY
-- Once a Pay Today batch's HDFC CSV has been downloaded (payment
-- initiated at the bank), a confirmed payment can no longer simply be
-- sent back to due by the accountant. If the BANK declines that
-- payment, the accountant presses "Bank declined", fills a reason,
-- and the request goes to the OWNER for approval:
--   • Owner APPROVES → the payment is cancelled and its bill drops
--     back into Due Bills.
--   • Owner REJECTS  → nothing changes, the payment stays confirmed.
--
-- A not-yet-downloaded batch keeps the simpler "Back to due" exit (no
-- bank money moved yet), so it doesn't need this approval gate.
--
-- DATA MODEL — purely additive. Six nullable columns on bill_payments
-- that hold the pending/approved/rejected decline request + who/when.
-- The actual "go back to due" effect reuses the existing cancel path
-- (status → 'cancelled') on owner approval, so no new status enum
-- value and no trigger changes.
--
-- SAFETY: this migration MUTATES NO EXISTING ROW and deletes nothing.
-- It only ADDs columns (idempotent IF NOT EXISTS). Every column is
-- nullable with no default beyond NULL, so existing payments are
-- byte-identical after running. Real money / paid history untouched.

BEGIN;

ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS bank_decline_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS bank_decline_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS bank_decline_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bank_decline_requested_by UUID NULL,
  ADD COLUMN IF NOT EXISTS bank_decline_resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bank_decline_resolved_by UUID NULL;

-- Lifecycle: NULL (none) → 'pending' (accountant requested) →
--            'approved' (owner OK → payment cancelled → bill to due)
--          or 'rejected' (owner declined → payment stays confirmed;
--                          accountant may request again later).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bill_payments_bank_decline_status_chk'
  ) THEN
    ALTER TABLE public.bill_payments
      ADD CONSTRAINT bill_payments_bank_decline_status_chk
      CHECK (bank_decline_status IS NULL
             OR bank_decline_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Fast lookup of the owner's pending-decline queue.
CREATE INDEX IF NOT EXISTS bill_payments_bank_decline_pending_idx
  ON public.bill_payments (bank_decline_requested_at)
  WHERE bank_decline_status = 'pending';

COMMIT;

-- ROLLBACK (manual):
-- ALTER TABLE public.bill_payments DROP CONSTRAINT IF EXISTS bill_payments_bank_decline_status_chk;
-- DROP INDEX IF EXISTS public.bill_payments_bank_decline_pending_idx;
-- ALTER TABLE public.bill_payments
--   DROP COLUMN IF EXISTS bank_decline_status,
--   DROP COLUMN IF EXISTS bank_decline_reason,
--   DROP COLUMN IF EXISTS bank_decline_requested_at,
--   DROP COLUMN IF EXISTS bank_decline_requested_by,
--   DROP COLUMN IF EXISTS bank_decline_resolved_at,
--   DROP COLUMN IF EXISTS bank_decline_resolved_by;
