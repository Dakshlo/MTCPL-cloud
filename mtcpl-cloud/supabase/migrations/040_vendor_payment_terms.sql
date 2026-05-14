-- ──────────────────────────────────────────────────────────────────────
-- Migration 040 — Per-vendor payment terms
-- ──────────────────────────────────────────────────────────────────────
-- Replaces the global "45-day rule" introduced as a UI constant (Daksh
-- said "company pays around 45 days after bill date") with a per-
-- vendor configuration. Different vendors give different credit
-- windows: a cement supplier might run net-30, scaffolding hire might
-- be due immediately, etc. Now each bill_vendor carries its own
-- payment_terms_days.
--
-- Semantics:
--   • 0    → "Current" — pay immediately. Premature flag never fires.
--   • >0   → "Pay N days after bill date". The Due Bills / Pay Today
--            premature-payment warning kicks in for any bill younger
--            than this vendor's terms.
--   • NULL → no terms set, fall back to the legacy 45-day default in
--            application code (so existing vendors continue to work).
--
-- Stored as a plain INT. App-side validation caps it at a sane upper
-- bound (180 days) to catch typos; DB enforces only non-negative.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bill_vendors
  ADD COLUMN IF NOT EXISTS payment_terms_days INT NULL
    CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0);

COMMENT ON COLUMN public.bill_vendors.payment_terms_days IS
  'Days after bill_date when this vendor is paid. NULL = use app-level default (45). 0 = pay on receipt.';

NOTIFY pgrst, 'reload schema';

COMMIT;
