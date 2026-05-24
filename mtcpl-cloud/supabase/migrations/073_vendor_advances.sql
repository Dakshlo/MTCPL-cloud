-- ──────────────────────────────────────────────────────────────────
-- Migration 073: Vendor Advance Payment (credit-pool model)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh's dad: "Vendor demands money before sending the bill. Pay
-- the advance now; when the bill arrives, we already paid part of
-- it so only the gap needs paying."
--
-- Model: per-vendor credit balance.
--   1. Owner records an advance (vendor + amount + reason). Status
--      starts at 'proposed' (no submit/approve gate — owner IS
--      the authority).
--   2. Advance rides the existing propose → confirm → HDFC CSV →
--      paid pipeline so the bank ledger stays honest.
--   3. Paid advance sits as vendor credit. View
--      vendor_advance_balance tells the UI how much is available.
--   4. When a bill from that vendor is entered (or any time
--      afterwards), accountant chooses how much credit to apply.
--      Application = synthetic bill_payments row tagged
--      is_advance_application=TRUE. Existing recalc trigger
--      reduces the bill's amount_outstanding for free.
--
-- The synthetic application row is filtered out of HDFC CSV +
-- Final Audit + voucher PDF (money already moved when the advance
-- was paid — re-counting it would double-spend).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── Advance entity + payment-pipeline lifecycle ────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_advances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'ADV-N' auto-generated via vendor_advance_token_seq; assigned
  -- by the server action so we can format it cleanly.
  token           TEXT UNIQUE NOT NULL,
  vendor_id       UUID NOT NULL
                    REFERENCES public.bill_vendors(id) ON DELETE RESTRICT,
  amount          NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description     TEXT NOT NULL CHECK (length(description) > 0
                                       AND length(description) <= 500),
  note            TEXT NULL CHECK (length(coalesce(note,'')) <= 500),
  -- Lifecycle mirrors bill_payments (mig 028 + mig 052):
  --   proposed → confirmed → paid                  (happy path)
  --   proposed → cancelled                         (pre-pay abort)
  --   confirmed → bank_rejected → ... → paid       (retry path)
  -- No 'pending_approval' state — owner records the advance, owner
  -- confirms; submitting IS approving.
  status          TEXT NOT NULL CHECK (status IN (
                    'proposed', 'confirmed', 'paid',
                    'cancelled', 'bank_rejected'
                  )),
  -- Pipeline timestamps + actors
  proposed_by     UUID NOT NULL REFERENCES public.profiles(id),
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by    UUID NULL     REFERENCES public.profiles(id),
  confirmed_at    TIMESTAMPTZ NULL,
  paid_by         UUID NULL     REFERENCES public.profiles(id),
  paid_at         TIMESTAMPTZ NULL,
  payment_method  TEXT NULL,
  payment_reference TEXT NULL,
  hdfc_csv_downloaded_at TIMESTAMPTZ NULL,
  -- Bank rejection mirror (mig 052)
  bank_rejected_by   UUID NULL REFERENCES public.profiles(id),
  bank_rejected_at   TIMESTAMPTZ NULL,
  bank_rejection_reason TEXT NULL,
  -- Soft-cancel
  cancelled_at    TIMESTAMPTZ NULL,
  cancelled_by    UUID NULL     REFERENCES public.profiles(id),
  cancel_reason   TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS public.vendor_advance_token_seq;

-- "Open advances" — paid, not cancelled. The vendor_advance_balance
-- view further narrows to non-fully-consumed via the applications
-- join.
CREATE INDEX IF NOT EXISTS vendor_advances_open_idx
  ON public.vendor_advances (vendor_id, paid_at DESC)
  WHERE status = 'paid' AND cancelled_at IS NULL;

-- Pipeline filter — Pay Today reads these alongside bill_payments
-- proposed/confirmed.
CREATE INDEX IF NOT EXISTS vendor_advances_pipeline_idx
  ON public.vendor_advances (status, proposed_at DESC)
  WHERE status IN ('proposed', 'confirmed', 'bank_rejected');

-- Same RLS posture as cnc_vendor_expenses / vendor_private_notes —
-- enable RLS, no policies. All access goes through service_role.
ALTER TABLE public.vendor_advances ENABLE ROW LEVEL SECURITY;

-- ── Application junction: which bill consumed how much of which advance
-- One advance can split across many bills; one bill can pull from
-- many advances. unapply lifecycle for owner mistake-correction.
CREATE TABLE IF NOT EXISTS public.vendor_advance_applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_advance_id UUID NOT NULL
                      REFERENCES public.vendor_advances(id) ON DELETE RESTRICT,
  bill_id           UUID NOT NULL
                      REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount_applied    NUMERIC(14, 2) NOT NULL CHECK (amount_applied > 0),
  -- Synthetic bill_payments row we insert when applying. Lets
  -- unapply find + soft-cancel the right one without ambiguity.
  payment_row_id    UUID NOT NULL
                      REFERENCES public.bill_payments(id) ON DELETE RESTRICT,
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by        UUID NOT NULL REFERENCES public.profiles(id),
  note              TEXT NULL,
  -- Unapply (owner reversal)
  unapplied_at      TIMESTAMPTZ NULL,
  unapplied_by      UUID NULL REFERENCES public.profiles(id),
  unapply_reason    TEXT NULL
);

CREATE INDEX IF NOT EXISTS vendor_advance_applications_by_bill_idx
  ON public.vendor_advance_applications (bill_id)
  WHERE unapplied_at IS NULL;
CREATE INDEX IF NOT EXISTS vendor_advance_applications_by_advance_idx
  ON public.vendor_advance_applications (vendor_advance_id)
  WHERE unapplied_at IS NULL;

ALTER TABLE public.vendor_advance_applications ENABLE ROW LEVEL SECURITY;

-- Cap trigger: cannot apply more from one advance than its amount
-- minus the sum of already-active applications. Action layer also
-- enforces this with a friendlier error, but a DB trigger guards
-- against direct SQL edits + race conditions.
CREATE OR REPLACE FUNCTION public.enforce_advance_application_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total_applied NUMERIC(14,2);
  adv_amount    NUMERIC(14,2);
BEGIN
  -- Soft-cancel path is fine — releasing credit never violates the cap.
  IF NEW.unapplied_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT amount INTO adv_amount
    FROM public.vendor_advances
   WHERE id = NEW.vendor_advance_id;
  IF adv_amount IS NULL THEN
    RAISE EXCEPTION 'vendor_advance_id % not found', NEW.vendor_advance_id;
  END IF;
  SELECT COALESCE(SUM(amount_applied), 0) INTO total_applied
    FROM public.vendor_advance_applications
   WHERE vendor_advance_id = NEW.vendor_advance_id
     AND unapplied_at IS NULL
     AND id <> NEW.id;
  IF total_applied + NEW.amount_applied > adv_amount + 0.005 THEN
    RAISE EXCEPTION
      'Applied total (₹%) would exceed advance amount (₹%) on %',
      total_applied + NEW.amount_applied, adv_amount, NEW.vendor_advance_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vendor_advance_applications_cap ON public.vendor_advance_applications;
CREATE TRIGGER vendor_advance_applications_cap
  BEFORE INSERT OR UPDATE ON public.vendor_advance_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_advance_application_cap();

-- ── bill_payments flag — synthetic rows from advance applications
-- Tagged out of HDFC CSV, Pay Today, Final Audit. Existing
-- recalc_bill_amount_paid trigger (mig 028) picks them up normally
-- so the bill's amount_outstanding falls by amount_applied for free.
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS is_advance_application BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_advance_id      UUID NULL
    REFERENCES public.vendor_advances(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS bill_payments_advance_application_idx
  ON public.bill_payments (bill_id)
  WHERE is_advance_application = TRUE;

-- ── Per-vendor available advance balance (view) ──────────────────
-- = sum(advance.amount - applied) over paid + uncancelled advances.
-- Used by:
--   • vendor profile page — "Advance balance: ₹X" KPI tile
--   • bill entry form — "₹X available, apply ₹___?" callout
--   • Due Bills dashboard — "Open advances" KPI
CREATE OR REPLACE VIEW public.vendor_advance_balance AS
SELECT
  va.vendor_id,
  SUM(va.amount - COALESCE(app.applied_total, 0))::NUMERIC(14,2)
    AS available_balance,
  SUM(va.amount)::NUMERIC(14,2)                 AS total_paid,
  SUM(COALESCE(app.applied_total, 0))::NUMERIC(14,2)
    AS total_applied,
  COUNT(*) FILTER (
    WHERE va.amount - COALESCE(app.applied_total, 0) > 0.005
  )::INT AS open_advance_count
FROM public.vendor_advances va
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount_applied), 0) AS applied_total
    FROM public.vendor_advance_applications
   WHERE vendor_advance_id = va.id
     AND unapplied_at IS NULL
) app ON TRUE
WHERE va.status = 'paid' AND va.cancelled_at IS NULL
GROUP BY va.vendor_id;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Quick verify after the run:
--   SELECT vendor_id, available_balance, total_paid, total_applied,
--          open_advance_count
--     FROM public.vendor_advance_balance
--    ORDER BY available_balance DESC NULLS LAST LIMIT 20;
--
--   SELECT token, vendor_id, amount, status, paid_at
--     FROM public.vendor_advances
--    WHERE status = 'paid' AND cancelled_at IS NULL
--    ORDER BY paid_at DESC LIMIT 20;
