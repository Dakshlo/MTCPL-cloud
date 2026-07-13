-- 200: Invoice DISCOUNT on the final amount (Daksh, Jul 2026).
--
-- All four invoice paths (purchase / work-order / running / other sales) can
-- give a discount on the GRAND TOTAL (subtotal + GST): either a flat ₹ amount
-- or a % of the total. e.g. taxable 100 + 18 GST = 118; discount 18 → payable
-- 100. Default OFF (discount_mode NULL). The invoice prints "Less: Discount"
-- and an "Amount Payable" line; every totals consumer reports the payable.
--
--   discount_mode  'amount' | 'percent' | NULL (off)
--   discount_value the ₹ figure or the % figure

alter table public.challans
  add column if not exists discount_mode  text,
  add column if not exists discount_value numeric;

alter table public.bulk_invoices
  add column if not exists discount_mode  text,
  add column if not exists discount_value numeric;

alter table public.other_challans
  add column if not exists discount_mode  text,
  add column if not exists discount_value numeric;

notify pgrst, 'reload schema';
