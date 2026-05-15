-- ──────────────────────────────────────────────────────────────────
-- Migration 052: bank_rejected payment status + retry linkage
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh (May 2026): on Pay Today, a batch of confirmed payments goes
-- to HDFC as a single bulk CSV. HDFC processes each row independently
-- — typically 5 succeed, 1 fails (wrong IFSC, account closed,
-- beneficiary-name mismatch, insufficient funds, etc.).
--
-- Today the only way to handle the failure is "Send back to due,"
-- which dumps the row back into the outstanding-bills pool with no
-- memory of having been proposed, confirmed, uploaded, and rejected.
-- The accountant then has to remember context across days and
-- re-propose from scratch.
--
-- This migration introduces a fourth lifecycle state for
-- bill_payments — `bank_rejected` — that captures the "we tried, the
-- bank refused" case as a first-class row. The row sits in its own
-- holding section on the Pay Today screen until the accountant
-- chooses one of three exits:
--
--   1. 🔁 Try again — creates a NEW proposed payment row linked to
--      this one via previous_payment_id. The original stays as
--      `bank_rejected` forever as historical record. The new row
--      enters the proposed pool and can be batched with whatever
--      else is pending today.
--   2. 💸 Mark paid manually — same as a normal mark-paid (covers
--      "we paid him in cash that evening").
--   3. ↩ Send to due — final give-up. Row flips to `cancelled`.
--
-- Reason capture is mandatory (min 3 chars) so the audit trail
-- always has a "why" for every rejection.
--
-- Schema
-- ──────
--   bill_payment_status += 'bank_rejected'
--   bill_payments.bank_rejected_at      TIMESTAMPTZ
--   bill_payments.bank_rejected_by      UUID  → profiles(id)
--   bill_payments.bank_rejection_reason TEXT  (required when status=bank_rejected)
--   bill_payments.previous_payment_id   UUID  → bill_payments(id)
--                                       (set on the retry row, pointing back
--                                        at the bank_rejected row it replaces)
--
-- Triggers
-- ────────
--   • bill_payments_enforce_bank_rejection — BEFORE INSERT/UPDATE
--     ensures the reason + at + by columns are populated whenever
--     status='bank_rejected'.
--
-- Behaviour invariants preserved
-- ─────────────────────────────
--   • recalc_bill_amount_paid only sums status='paid' rows — a
--     bank_rejected row contributes nothing to amount_paid, so the
--     bill's outstanding correctly bounces back when a confirmed
--     payment is flipped to bank_rejected.
--   • bills.status flips approved↔fully_paid only via amount_paid,
--     so no extra trigger work is needed.
--   • bill_payments_paid_completeness CHECK is unaffected (only
--     constrains status='paid').
-- ──────────────────────────────────────────────────────────────────

-- ALTER TYPE … ADD VALUE has to live OUTSIDE the BEGIN/COMMIT block.
ALTER TYPE public.bill_payment_status ADD VALUE IF NOT EXISTS 'bank_rejected';

BEGIN;

-- ── Columns ─────────────────────────────────────────────────────────
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS bank_rejected_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bank_rejected_by      UUID NULL
                            REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_rejection_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS previous_payment_id   UUID NULL
                            REFERENCES public.bill_payments(id) ON DELETE SET NULL;

-- ── Invariant trigger ──────────────────────────────────────────────
-- Enforces that bank_rejected rows always have the metadata trio set.
-- CHECK constraint would work too but a trigger gives clearer error
-- messages and matches the pattern used elsewhere in this codebase.
CREATE OR REPLACE FUNCTION public.enforce_bank_rejection_invariant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'bank_rejected' THEN
    IF NEW.bank_rejection_reason IS NULL
       OR length(trim(NEW.bank_rejection_reason)) < 3 THEN
      RAISE EXCEPTION
        'bank_rejection_reason required (min 3 chars) when status=bank_rejected';
    END IF;
    IF NEW.bank_rejected_at IS NULL OR NEW.bank_rejected_by IS NULL THEN
      RAISE EXCEPTION
        'bank_rejected_at and bank_rejected_by required when status=bank_rejected';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bill_payments_enforce_bank_rejection ON public.bill_payments;
CREATE TRIGGER bill_payments_enforce_bank_rejection
  BEFORE INSERT OR UPDATE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bank_rejection_invariant();

-- ── Indexes ─────────────────────────────────────────────────────────
-- Pay Today "Bank rejected" section — list newest first.
CREATE INDEX IF NOT EXISTS bill_payments_bank_rejected_idx
  ON public.bill_payments (bank_rejected_at DESC)
  WHERE status = 'bank_rejected';

-- Retry-chain lookups (e.g. "show me the original rejection this
-- proposed row replaces").
CREATE INDEX IF NOT EXISTS bill_payments_previous_payment_idx
  ON public.bill_payments (previous_payment_id)
  WHERE previous_payment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Diagnostic queries (manual) ─────────────────────────────────────
-- Bank-rejected payments awaiting next action:
--   SELECT bp.id, bp.bill_id, b.token, v.name AS vendor,
--          bp.proposed_amount, bp.bank_rejected_at,
--          bp.bank_rejection_reason
--     FROM public.bill_payments bp
--     JOIN public.bills b ON b.id = bp.bill_id
--     JOIN public.bill_vendors v ON v.id = b.bill_vendor_id
--    WHERE bp.status = 'bank_rejected'
--    ORDER BY bp.bank_rejected_at DESC;
--
-- Retry chain for a given original rejection:
--   WITH RECURSIVE chain AS (
--     SELECT id, status, proposed_amount, previous_payment_id, 1 AS depth
--       FROM public.bill_payments WHERE id = '<original-id>'
--     UNION ALL
--     SELECT bp.id, bp.status, bp.proposed_amount, bp.previous_payment_id, c.depth + 1
--       FROM public.bill_payments bp
--       JOIN chain c ON bp.previous_payment_id = c.id
--   )
--   SELECT * FROM chain ORDER BY depth;
