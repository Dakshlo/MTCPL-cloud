-- Migration 085 — "Settle with debit" for flagged overpayments.
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- When Final Audit flags a payment as an overpayment (MTCPL paid a
-- vendor MORE than a bill was for), the auditor can settle the
-- excess by applying it as a DEBIT against another OPEN bill of the
-- SAME vendor — reducing that bill's outstanding — pending OWNER
-- approval. No bank money moves (the cash already left the bank);
-- this is a paper reallocation of the excess the vendor already holds.
--
-- Example: Daksh Enterprises bill = ₹1,00,000 but ₹1,20,000 was paid
-- (₹20,000 excess → flagged). Auditor opens "Settle with debit",
-- picks another open bill of Daksh Enterprises, types ₹20,000. Owner
-- approves → that bill's outstanding drops by ₹20,000, the flag moves
-- to "Settled", and both bills get an audit-trail line.
--
-- MECHANISM (mirrors vendor-advance application, mig 073)
-- On OWNER approval we insert a synthetic, pre-paid bill_payments row
-- on the TARGET bill, tagged is_debit_settlement=TRUE. The existing
-- recalc_bill_amount_paid trigger then drops that bill's
-- amount_outstanding for free. The synthetic row is filtered out of
-- HDFC CSV + the Final Audit queue (no NEW money moved), exactly like
-- advance applications. Reversal = soft-cancel that synthetic row.
--
-- The original flagged payment's final_audit_status STAYS 'flagged'
-- (its audit history is permanent, and we don't fight the
-- enforce_final_audit_invariant trigger from mig 053). "Settled" is a
-- SEPARATE marker: debit_settled_at, stamped only on owner approval.
--
-- SAFETY: purely additive. New table + 3 nullable columns on
-- bill_payments. This migration mutates NO existing row, deletes
-- nothing. The only runtime data changes happen later, at approval
-- time, and are reversible:
--   (a) one new synthetic bill_payments row on the target bill, and
--   (b) the debit_settled_at stamp on the flagged payment.
-- The original overpaid bill's real bank-payment row is never touched.

BEGIN;

-- ── 1. The debit-settlement record ──────────────────────────────────
-- One row per "Settle with debit". Lifecycle:
--   pending_approval → approved   (owner OK → synthetic row created)
--                    → rejected   (owner declines → nothing changes)
--   approved         → reversed   (owner later undoes → synthetic row
--                                   soft-cancelled, flag re-opened)
CREATE TABLE IF NOT EXISTS public.bill_debit_settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The flagged overpayment being settled (a paid bill_payments row).
  source_payment_id   UUID NOT NULL REFERENCES public.bill_payments(id) ON DELETE RESTRICT,
  -- That payment's bill (the overpaid bill).
  source_bill_id      UUID NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  -- The vendor — BOTH the overpaid bill and the target bill belong here.
  vendor_id           UUID NOT NULL REFERENCES public.bill_vendors(id) ON DELETE RESTRICT,
  -- The open bill the debit is applied against.
  target_bill_id      UUID NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note                TEXT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','approved','rejected','reversed')),
  -- The synthetic bill_payments row created on the target bill at
  -- approval — kept so a reversal can soft-cancel exactly that row.
  payment_row_id      UUID NULL REFERENCES public.bill_payments(id) ON DELETE SET NULL,
  created_by          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ NULL,
  rejected_by         UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at         TIMESTAMPTZ NULL,
  reject_reason       TEXT NULL,
  reversed_by         UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  reversed_at         TIMESTAMPTZ NULL,
  -- A flagged payment can only have ONE non-terminal settlement at a
  -- time (pending or approved). Rejected/reversed ones free it up.
  -- Enforced in the server action; this partial unique index is the
  -- DB backstop.
  CONSTRAINT bds_amount_sane CHECK (amount <= 100000000)
);

CREATE UNIQUE INDEX IF NOT EXISTS bds_one_active_per_source_idx
  ON public.bill_debit_settlements (source_payment_id)
  WHERE status IN ('pending_approval', 'approved');

CREATE INDEX IF NOT EXISTS bds_target_bill_idx
  ON public.bill_debit_settlements (target_bill_id);
CREATE INDEX IF NOT EXISTS bds_status_idx
  ON public.bill_debit_settlements (status, created_at DESC);
CREATE INDEX IF NOT EXISTS bds_pending_idx
  ON public.bill_debit_settlements (created_at DESC)
  WHERE status = 'pending_approval';

-- ── 2. Markers on bill_payments ─────────────────────────────────────
--   is_debit_settlement  — the synthetic row on the TARGET bill (so it
--                          can be excluded from HDFC CSV + Final Audit,
--                          and labelled "Debit" on the bill's payment
--                          cards). Mirrors is_advance_application.
--   debit_settled_at     — stamped on the FLAGGED payment when the
--                          owner approves; drives the "Settled" group
--                          on the Flagged Payments page. Cleared on
--                          reversal.
--   debit_settlement_id  — links the flagged payment to its settlement.
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS is_debit_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS debit_settled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS debit_settlement_id UUID NULL
    REFERENCES public.bill_debit_settlements(id) ON DELETE SET NULL;

-- ── 3. RLS ──────────────────────────────────────────────────────────
-- Read-all for authenticated (mirrors the accounts module); every
-- WRITE goes through a server action on the admin / service-role
-- client, which bypasses RLS.
ALTER TABLE public.bill_debit_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bds_select_authenticated ON public.bill_debit_settlements;
CREATE POLICY bds_select_authenticated ON public.bill_debit_settlements
  FOR SELECT TO authenticated USING (TRUE);

NOTIFY pgrst, 'reload schema';
COMMIT;
