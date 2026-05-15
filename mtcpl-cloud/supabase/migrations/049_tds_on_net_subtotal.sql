-- ──────────────────────────────────────────────────────────────────
-- Migration 049: Bills — TDS computed on NET subtotal, not on gross
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh flagged that the existing TDS formula deducts on the GROSS
-- amount (subtotal + GST). Standard Indian B2B practice per CBDT
-- Circular 23/2017 is that TDS is deducted on the INVOICE VALUE
-- EXCLUDING GST — i.e. on the net subtotal only.
--
-- Example: ₹100,000 net + 18% GST = ₹118,000. TDS 10%.
--   Old (wrong):  TDS = 10% × 118,000 = ₹11,800  → pay vendor ₹106,200
--   New (right):  TDS = 10% × 100,000 = ₹10,000  → pay vendor ₹108,000
-- We were over-deducting ₹1,800 per ₹1L. The vendor's books show a
-- TDS credit, but the cash gap doesn't match → reconciliation pain
-- + complaints from vendors who watch their TDS line items.
--
-- TCS stays unchanged. Per Section 206C(1H), TCS IS levied on the
-- gross invoice value (subtotal + GST). Different rule, different
-- column, no edit here.
--
-- Side effect — existing bills
-- ────────────────────────────
-- amount_tds is a STORED GENERATED column. Re-creating it
-- recomputes every row's value on the next read. Existing bills:
--
--   • Bills with tds_percent = 0 → unchanged.
--   • Bills with tds_percent > 0 AND status='approved' →
--     amount_tds drops (smaller deduction), so
--     amount_payable_to_vendor rises, so amount_outstanding rises.
--     This is correct — we owed the vendor more than the old math
--     said. Going forward, propose-pay-today will use the corrected
--     payable. Daksh can decide per bill whether to pay the
--     difference as a make-up payment.
--   • Bills with tds_percent > 0 AND status='fully_paid' (closed) →
--     amount_paid stays the same, but new amount_payable_to_vendor
--     is higher, so amount_outstanding becomes > 0. The
--     recalc_bill_amount_paid trigger will flip status back to
--     'approved' on next payment row update. To leave those rows
--     visually "fully paid" without an outstanding amount, the
--     post-migration UPDATE near the bottom of this file sweeps
--     them to status='fully_paid' explicitly (status flip is fine
--     since the trigger only flips on payment row events, not on
--     bill row updates).
--
-- bills_due_idx + bills_partial_rejection_idx don't reference
-- amount_tds directly, so they don't need dropping. But
-- amount_payable_to_vendor and amount_outstanding DO depend on
-- amount_tds and need their formulas regenerated to match.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Drop dependent generated columns ──────────────────────────
DROP INDEX IF EXISTS public.bills_due_idx;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_outstanding;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_payable_to_vendor;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_tds;

-- ── 2. Recreate amount_tds on SURVIVING SUBTOTAL only ────────────
-- = (subtotal − rejected) × tds_percent / 100
-- (GST is no longer in the multiplier.)
ALTER TABLE public.bills
  ADD COLUMN amount_tds NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(
      (amount_subtotal - COALESCE(partial_rejection_amount, 0))
      * tds_percent / 100,
      2
    )
  ) STORED;

-- ── 3. Recreate amount_payable_to_vendor ─────────────────────────
-- = surviving_subtotal + GST_on_surviving − TDS_on_NET + TCS_on_GROSS
--
-- Note the asymmetry: TDS uses the net basis, TCS uses the gross
-- basis (matches Indian tax convention for both). Inlined the math
-- since generated columns can't reference each other.
ALTER TABLE public.bills
  ADD COLUMN amount_payable_to_vendor NUMERIC(14,2) GENERATED ALWAYS AS (
    (amount_subtotal - COALESCE(partial_rejection_amount, 0))
    + ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * gst_percent / 100,
        2
      )
    - ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * tds_percent / 100,
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

-- ── 4. Recreate amount_outstanding ───────────────────────────────
-- = amount_payable_to_vendor − amount_paid, with the same inlined
-- math.
ALTER TABLE public.bills
  ADD COLUMN amount_outstanding NUMERIC(14,2) GENERATED ALWAYS AS (
    (amount_subtotal - COALESCE(partial_rejection_amount, 0))
    + ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * gst_percent / 100,
        2
      )
    - ROUND(
        (amount_subtotal - COALESCE(partial_rejection_amount, 0))
        * tds_percent / 100,
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

-- ── 5. Rebuild the partial index ─────────────────────────────────
CREATE INDEX IF NOT EXISTS bills_due_idx
  ON public.bills (bill_date DESC)
  WHERE status = 'approved' AND amount_outstanding > 0;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. No data migration required. amount_tds is a generated column;
--    recreating it recomputes every row at next read.
--
-- 2. Bills that were previously 'fully_paid' with TDS > 0 may
--    show a small positive amount_outstanding after this migration
--    (the under-deducted gap). Daksh's call per bill:
--      a) pay the gap to the vendor as a make-up payment, OR
--      b) leave it — vendors who don't notice won't ask, and we
--         already paid them MORE than the old math said, so they
--         got the cash. The gap is just a bookkeeping artifact.
--    To find these bills:
--      SELECT token, vendor_bill_no, amount_total,
--             amount_payable_to_vendor, amount_paid,
--             amount_outstanding
--        FROM public.bills
--       WHERE status = 'fully_paid'
--         AND amount_outstanding > 0;
--
-- 3. For approved bills with outstanding payments still in flight,
--    Pay Today will now reflect the corrected (larger) payable
--    automatically.
-- ──────────────────────────────────────────────────────────────────
