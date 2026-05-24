-- ──────────────────────────────────────────────────────────────────
-- Migration 072: Hold-amount on bills (owner withholds part of bill)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh: "Owner wants to hold ₹50,000 from a ₹1L bill of Daksh
-- Enterprises. Accountant can then propose only the remaining
-- ₹50,000. Visual marker + a filter so we can find held bills.
-- Dad can release the hold."
--
-- Approach
-- ────────
-- • Add held_amount column (NUMERIC, default 0) + held_reason +
--   held_at + held_by. One active hold per bill — re-holding
--   simply overwrites these fields (audit log keeps history).
-- • Range-check: held_amount must be 0..amount_payable_to_vendor.
--   We can't constrain against amount_outstanding (which is itself
--   GENERATED — dependency cycle), so we enforce a soft cap at
--   the action layer too.
-- • amount_outstanding (GENERATED STORED) stays untouched. The
--   "proposable" amount = amount_outstanding - held_amount is
--   derived at query/action time. Held bills still appear as due;
--   they just have a 🔒 chip and a clamped proposable amount.
-- • Partial index on bills WHERE held_amount > 0 powers the
--   "🔒 Held only" filter on the bills list.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS held_amount   NUMERIC(14, 2) NOT NULL DEFAULT 0
    CHECK (held_amount >= 0),
  ADD COLUMN IF NOT EXISTS held_reason   TEXT NULL
    CHECK (held_reason IS NULL OR length(held_reason) <= 500),
  ADD COLUMN IF NOT EXISTS held_at       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS held_by       UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bills.held_amount IS
  'Owner-withheld amount (₹). Subtracted from amount_outstanding when computing proposable. Owner/developer only via holdBillAmountAction.';
COMMENT ON COLUMN public.bills.held_reason IS
  'Why the owner held the money — quality dispute, retention, shortage, etc. Surfaced on the bill page + Pay Today chip.';

CREATE INDEX IF NOT EXISTS bills_active_hold_idx
  ON public.bills (bill_vendor_id, held_at DESC)
  WHERE held_amount > 0;

-- Range guard at the schema level — the action also enforces this,
-- but a deferred trigger here means stale data from manual SQL
-- edits can't break the proposable-amount math. amount_total is a
-- safer ceiling than amount_payable_to_vendor (which factors in
-- TDS/TCS/partial-rejection) for a sanity check.
CREATE OR REPLACE FUNCTION public.enforce_bill_held_amount_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.held_amount > 0 AND NEW.held_amount > NEW.amount_total THEN
    RAISE EXCEPTION
      'held_amount (% ) cannot exceed amount_total (%) on bill %',
      NEW.held_amount, NEW.amount_total, NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bills_enforce_held_amount_cap ON public.bills;
CREATE TRIGGER bills_enforce_held_amount_cap
  BEFORE INSERT OR UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bill_held_amount_cap();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Quick verify:
--   SELECT b.token, b.held_amount, b.held_reason, b.held_at,
--          v.name AS vendor
--     FROM public.bills b
--     JOIN public.bill_vendors v ON v.id = b.bill_vendor_id
--    WHERE b.held_amount > 0
--    ORDER BY b.held_at DESC LIMIT 20;
