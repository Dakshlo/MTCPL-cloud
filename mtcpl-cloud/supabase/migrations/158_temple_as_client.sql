-- 158 — Temple IS the invoicing client.
--
-- Drops the separate "invoice party" master in favour of billing info living
-- directly on the temple (no double-entry of the same name). Production roles
-- keep editing the temple's operational fields in Settings; the accountant
-- fills the billing fields (GSTIN, PAN, address, email, phone) per temple in
-- Invoicing. A challan now belongs to a temple directly.
--
-- Additive + idempotent. The old invoice_parties table + temples.invoice_party_id
-- stay in place (unused) so nothing breaks mid-deploy; the one-time data cleanup
-- (delete the test parties + their challans/invoices) is run separately by hand.

-- Billing info on the temple (client = temple; name = temple.name).
ALTER TABLE public.temples
  ADD COLUMN IF NOT EXISTS bill_gstin   TEXT,
  ADD COLUMN IF NOT EXISTS bill_pan     TEXT,
  ADD COLUMN IF NOT EXISTS bill_address TEXT,
  ADD COLUMN IF NOT EXISTS bill_email   TEXT,
  ADD COLUMN IF NOT EXISTS bill_phone   TEXT;

-- A challan now records its temple directly (client = temple). The legacy
-- invoice_party link becomes optional so dispatch-sourced challans need no party.
ALTER TABLE public.challans
  ADD COLUMN IF NOT EXISTS temple TEXT;

ALTER TABLE public.challans
  ALTER COLUMN invoice_party_id DROP NOT NULL;
