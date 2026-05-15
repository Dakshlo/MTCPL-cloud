-- ──────────────────────────────────────────────────────────────────
-- Migration 053: Final Audit role + per-payment verification state
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh (May 2026): after a payment is marked paid, the next step
-- in his real workflow is cross-checking the UTR/reference recorded
-- in MTCPL against the bank statement to confirm the money actually
-- moved to the right vendor. Today that recheck is informal — done
-- in his head, on paper, sometimes never. He wants:
--
--   1. A NEW dedicated role (final_auditor) responsible only for
--      this verification step. The role has full accountant powers
--      AND can stand in for the owner when confirming proposed
--      payments (owner backup when dad is unavailable).
--
--   2. A new "Final Audit" page that lists every paid payment
--      awaiting verification. Each row carries the UTR/reference,
--      amount, vendor, method — everything the auditor needs to
--      tick against the bank statement at a glance.
--
--   3. Two actions per pending row:
--        • ✓ Verified            → final_audit_status='verified'
--        • 🚩 Flag a problem      → final_audit_status='flagged' +
--                                    captured reason
--      Neither action reverses or alters the payment — it's a
--      checkpoint, not an approval. Flag just flags for the owner's
--      attention; the money is already gone.
--
--   4. The bill itself picks up a "PAID + VERIFIED" tag once all
--      its paid payments are verified. Flagged rows surface a 🚩
--      marker on the bill so the owner can investigate.
--
-- Schema
-- ──────
--   app_role += 'final_auditor'
--   bill_payments.final_audit_status TEXT
--                  CHECK IN ('pending','verified','flagged')
--                  DEFAULT 'pending'
--   bill_payments.final_audit_at TIMESTAMPTZ
--   bill_payments.final_audit_by UUID → profiles(id)
--   bill_payments.final_audit_flag_reason TEXT
--   bill_payments.final_audit_flag_note   TEXT
--
-- Backfill
-- ────────
-- Existing 'paid' rows are bulk-set to 'verified' with NULL at+by.
-- This is intentional — we don't want to surface a backlog of 200
-- historical audits the day the feature ships. From this point on
-- every new mark-paid lands at 'pending' and joins the queue.
--
-- The invariant trigger only enforces at+by when a row TRANSITIONS
-- into verified/flagged (i.e. OLD.final_audit_status != NEW.
-- final_audit_status). So the legacy backfill rows pass; future
-- updates that don't touch the audit column also pass; only fresh
-- verify/flag actions are enforced.
-- ──────────────────────────────────────────────────────────────────

-- ALTER TYPE … ADD VALUE has to live OUTSIDE BEGIN/COMMIT.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'final_auditor';

BEGIN;

-- ── Columns ─────────────────────────────────────────────────────────
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS final_audit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (final_audit_status IN ('pending', 'verified', 'flagged')),
  ADD COLUMN IF NOT EXISTS final_audit_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_audit_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_audit_flag_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_audit_flag_note TEXT NULL;

-- ── Legacy backfill ─────────────────────────────────────────────────
-- Set every historical 'paid' row to 'verified' so the feature ships
-- with an empty queue. NULL at+by signals "predates the feature."
-- This UPDATE runs BEFORE the invariant trigger exists below, so it
-- isn't blocked by the at/by enforcement.
UPDATE public.bill_payments
   SET final_audit_status = 'verified'
 WHERE status = 'paid'
   AND final_audit_status = 'pending';

-- ── Invariant trigger ──────────────────────────────────────────────
-- Enforces at+by + reason whenever a row TRANSITIONS to verified or
-- flagged. Legacy rows (already 'verified' before this trigger
-- existed) can be updated freely for non-audit fields without
-- tripping the gate because OLD.status == NEW.status means no
-- transition fired.
CREATE OR REPLACE FUNCTION public.enforce_final_audit_invariant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Transition to flagged → require reason + at + by.
  IF NEW.final_audit_status = 'flagged' AND
     (TG_OP = 'INSERT' OR OLD.final_audit_status IS DISTINCT FROM 'flagged') THEN
    IF NEW.final_audit_flag_reason IS NULL
       OR length(trim(NEW.final_audit_flag_reason)) < 3 THEN
      RAISE EXCEPTION
        'final_audit_flag_reason required (min 3 chars) when transitioning to flagged';
    END IF;
    IF NEW.final_audit_at IS NULL OR NEW.final_audit_by IS NULL THEN
      RAISE EXCEPTION
        'final_audit_at and final_audit_by required when transitioning to flagged';
    END IF;
  END IF;

  -- Transition to verified → require at + by (reason not relevant).
  IF NEW.final_audit_status = 'verified' AND
     (TG_OP = 'INSERT' OR OLD.final_audit_status IS DISTINCT FROM 'verified') THEN
    IF NEW.final_audit_at IS NULL OR NEW.final_audit_by IS NULL THEN
      RAISE EXCEPTION
        'final_audit_at and final_audit_by required when transitioning to verified';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bill_payments_enforce_final_audit ON public.bill_payments;
CREATE TRIGGER bill_payments_enforce_final_audit
  BEFORE INSERT OR UPDATE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_final_audit_invariant();

-- ── Indexes ─────────────────────────────────────────────────────────
-- Final Audit page — pending queue sorted by paid_at (newest first).
-- Partial index keeps the queue tiny (typically <50 rows).
CREATE INDEX IF NOT EXISTS bill_payments_final_audit_pending_idx
  ON public.bill_payments (paid_at DESC)
  WHERE status = 'paid' AND final_audit_status = 'pending';

-- Owner attention list — flagged payments newest first.
CREATE INDEX IF NOT EXISTS bill_payments_final_audit_flagged_idx
  ON public.bill_payments (final_audit_at DESC)
  WHERE final_audit_status = 'flagged';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Diagnostic queries (manual) ─────────────────────────────────────
-- Pending audits:
--   SELECT bp.id, b.token, v.name, bp.paid_amount, bp.payment_method,
--          bp.payment_reference, bp.paid_at, p.full_name AS paid_by
--     FROM public.bill_payments bp
--     JOIN public.bills b ON b.id = bp.bill_id
--     JOIN public.bill_vendors v ON v.id = b.bill_vendor_id
--     LEFT JOIN public.profiles p ON p.id = bp.paid_by
--    WHERE bp.status = 'paid' AND bp.final_audit_status = 'pending'
--    ORDER BY bp.paid_at DESC;
--
-- Flagged audits (owner attention):
--   SELECT bp.id, b.token, v.name, bp.paid_amount,
--          bp.final_audit_flag_reason, bp.final_audit_flag_note,
--          bp.final_audit_at, p.full_name AS audited_by
--     FROM public.bill_payments bp
--     JOIN public.bills b ON b.id = bp.bill_id
--     JOIN public.bill_vendors v ON v.id = b.bill_vendor_id
--     LEFT JOIN public.profiles p ON p.id = bp.final_audit_by
--    WHERE bp.final_audit_status = 'flagged'
--    ORDER BY bp.final_audit_at DESC;
