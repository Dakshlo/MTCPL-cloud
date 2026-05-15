-- ──────────────────────────────────────────────────────────────────
-- Migration 045: Bills — partial rejection (debit-note math)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Common Indian B2B scenario: vendor invoices ₹100,000 + 18% GST =
-- ₹118,000 for raw material. On receipt we inspect — only 60% is
-- usable, the rest is wet / damaged / wrong spec. The vendor's
-- invoice paper still says ₹118,000 (audit truth), but cashflow truth
-- is we pay only on the ₹60,000 we actually accepted.
--
-- Today the system has no way to express this gap. The biller enters
-- the full ₹118,000, the approver approves, the accountant proposes
-- ₹118,000, the owner confirms, and the ₹40,000-worth of bad
-- material has no documented home. The accountant ends up either
-- over-paying or hand-editing the proposed_amount — both lose the
-- audit trail.
--
-- This migration adds a "partial rejection" event to bills:
--   - amount_subtotal stays at ₹100,000 (vendor's invoice value)
--   - partial_rejection_amount = ₹40,000 (what we won't pay for)
--   - amount_total stays at ₹118,000 (vendor's invoice TOTAL)
--   - amount_payable_to_vendor recomputes to ₹70,800 (cashflow truth,
--     factoring GST + TDS + TCS on the surviving subtotal)
--   - amount_outstanding follows amount_payable_to_vendor
--
-- The vendor's invoice number + amount stay sacred. The reduction is
-- a separate documented business event with reason + who-marked +
-- when-marked, just like any other bill mutation.
--
-- Approach
-- ────────
-- Four new columns on bills:
--   partial_rejection_amount  NUMERIC(14,2) DEFAULT 0
--   partial_rejection_note    TEXT
--   partial_rejection_at      TIMESTAMPTZ
--   partial_rejection_by      UUID → profiles
--
-- Rebuild the four downstream generated columns (amount_tds,
-- amount_tcs, amount_payable_to_vendor, amount_outstanding) so they
-- compute on the SURVIVING subtotal:
--
--   surviving = amount_subtotal − COALESCE(partial_rejection_amount, 0)
--   payable   = surviving + ROUND(surviving × gst_percent / 100, 2)
--   tds       = ROUND(payable × tds_percent / 100, 2)
--   tcs       = ROUND(payable × tcs_percent / 100, 2)
--   amount_payable_to_vendor = payable − tds + tcs
--   amount_outstanding        = amount_payable_to_vendor − amount_paid
--
-- For legacy rows (partial_rejection_amount = 0) every formula
-- produces the EXACT same number as before — no observable change.
--
-- amount_gst, amount_cgst, amount_sgst, amount_igst, amount_total
-- stay unchanged. Those columns represent the vendor's invoice, not
-- our payable position. Keeping them stable means existing reports
-- and the bill summary card's "Bill total" line still match the
-- physical paper the vendor handed over.
--
-- bills_due_idx is dropped + recreated because it references
-- amount_outstanding. (Same pattern as mig 042.)
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. New columns ───────────────────────────────────────────────
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS partial_rejection_amount NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (partial_rejection_amount >= 0
           AND partial_rejection_amount <= amount_subtotal),
  ADD COLUMN IF NOT EXISTS partial_rejection_note   TEXT NULL,
  ADD COLUMN IF NOT EXISTS partial_rejection_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS partial_rejection_by     UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 2. Drop dependent generated columns ──────────────────────────
-- Order matters: amount_outstanding depends on amount_payable_to_vendor,
-- both of which use amount_tds + amount_tcs internally (we'll inline
-- the math on the recreate to avoid generated-column-cross-references).
-- bills_due_idx references amount_outstanding so drop it first.
DROP INDEX IF EXISTS public.bills_due_idx;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_outstanding;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_payable_to_vendor;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_tds;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_tcs;

-- ── 3. Recreate amount_tds / amount_tcs on surviving-subtotal ────
-- These now reflect what we'll deduct/add on the AMOUNT WE PAY,
-- not on the original invoice total. Aligns with tax convention
-- (TDS is on what's actually paid). Legacy rows with
-- partial_rejection_amount=0 land on the exact same number as
-- pre-mig.
ALTER TABLE public.bills
  ADD COLUMN amount_tds NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(
      (
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        + ROUND(
            (amount_subtotal - COALESCE(partial_rejection_amount, 0))
            * gst_percent / 100,
            2
          )
      ) * tds_percent / 100,
      2
    )
  ) STORED;

ALTER TABLE public.bills
  ADD COLUMN amount_tcs NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(
      (
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        + ROUND(
            (amount_subtotal - COALESCE(partial_rejection_amount, 0))
            * gst_percent / 100,
            2
          )
      ) * tcs_percent / 100,
      2
    )
  ) STORED;

-- ── 4. Recreate amount_payable_to_vendor ─────────────────────────
-- = surviving_subtotal + GST_on_surviving − TDS_on_surviving
--   + TCS_on_surviving
--
-- Inlined the full math (no cross-references between generated
-- columns) so Postgres can compute deterministically without
-- dependency tracking.
ALTER TABLE public.bills
  ADD COLUMN amount_payable_to_vendor NUMERIC(14,2) GENERATED ALWAYS AS (
    (amount_subtotal - COALESCE(partial_rejection_amount, 0))
    + ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * gst_percent / 100,
        2
      )
    - ROUND(
        (
          (amount_subtotal - COALESCE(partial_rejection_amount, 0))
          + ROUND(
              (amount_subtotal - COALESCE(partial_rejection_amount, 0))
              * gst_percent / 100,
              2
            )
        ) * tds_percent / 100,
        2
      )
    + ROUND(
        (
          (amount_subtotal - COALESCE(partial_rejection_amount, 0))
          + ROUND(
              (amount_subtotal - COALESCE(partial_rejection_amount, 0))
              * gst_percent / 100,
              2
            )
        ) * tcs_percent / 100,
        2
      )
  ) STORED;

-- ── 5. Recreate amount_outstanding ───────────────────────────────
-- = amount_payable_to_vendor − amount_paid, same as mig 042 but
-- now built on the rejection-aware payable.
ALTER TABLE public.bills
  ADD COLUMN amount_outstanding NUMERIC(14,2) GENERATED ALWAYS AS (
    (amount_subtotal - COALESCE(partial_rejection_amount, 0))
    + ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * gst_percent / 100,
        2
      )
    - ROUND(
        (
          (amount_subtotal - COALESCE(partial_rejection_amount, 0))
          + ROUND(
              (amount_subtotal - COALESCE(partial_rejection_amount, 0))
              * gst_percent / 100,
              2
            )
        ) * tds_percent / 100,
        2
      )
    + ROUND(
        (
          (amount_subtotal - COALESCE(partial_rejection_amount, 0))
          + ROUND(
              (amount_subtotal - COALESCE(partial_rejection_amount, 0))
              * gst_percent / 100,
              2
            )
        ) * tcs_percent / 100,
        2
      )
    - amount_paid
  ) STORED;

-- ── 6. Rebuild the partial index ─────────────────────────────────
CREATE INDEX IF NOT EXISTS bills_due_idx
  ON public.bills (bill_date DESC)
  WHERE status = 'approved' AND amount_outstanding > 0;

-- ── 7. Audit-trail helper index ──────────────────────────────────
-- Optional: lets the Reports module query "how much material did we
-- reject this month" cheaply. Partial — only indexes rows where a
-- rejection was actually marked.
CREATE INDEX IF NOT EXISTS bills_partial_rejection_idx
  ON public.bills (partial_rejection_at DESC)
  WHERE partial_rejection_amount > 0;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. No data migration required. Existing bills get
--    partial_rejection_amount = 0 and the four generated columns
--    compute to the same numbers they had before.
--
-- 2. RLS: bills already has authenticated read; the new columns ride
--    on that policy. No new policy needed.
--
-- 3. UI: the bill detail page (/accounts/bills/[id]) gets a new
--    "Partial rejection" card with a "+ Mark partial rejection"
--    button visible to developer / owner / accountant when:
--      - bill.status === 'approved'
--      - no bill_payments row has status='paid'
--    Editable until the first payment lands paid; then locked.
--
-- 4. No new permission helper — markPartialRejectionAction reuses
--    canManageAccounts() (developer/owner/accountant). The cross-
--    checker (Mafat) verifies via the existing bill audit trail.
-- ──────────────────────────────────────────────────────────────────
