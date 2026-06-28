-- 165: structured Billing + Shipping for temple-as-client (Daksh, June 2026).
--
-- The "Client billing" page treats each temple as its own invoicing client.
-- Mig 158 added bill_gstin/bill_pan/bill_address/bill_email/bill_phone. Daksh
-- wants a full Billing block + a separate Shipping block (each Name / Address /
-- City / State / State code / GSTIN / PAN / Phone / Email) plus optional
-- Vendor code + Work order no, all shown on the tax invoice. If shipping is
-- left blank the invoice falls back to the billing address.
--
-- Additive + idempotent (matches mig 158 house style). All TEXT.

alter table public.temples
  -- remainder of the BILLING block (gstin/pan/address/email/phone already exist)
  add column if not exists bill_name        text,
  add column if not exists bill_city        text,
  add column if not exists bill_state       text,
  add column if not exists bill_state_code  text,
  -- full SHIPPING block
  add column if not exists ship_name        text,
  add column if not exists ship_address     text,
  add column if not exists ship_city        text,
  add column if not exists ship_state       text,
  add column if not exists ship_state_code  text,
  add column if not exists ship_gstin       text,
  add column if not exists ship_pan         text,
  add column if not exists ship_phone       text,
  add column if not exists ship_email       text,
  -- shared optional, shown on the bill only when filled
  add column if not exists vendor_code      text,
  add column if not exists work_order_no    text;

notify pgrst, 'reload schema';
