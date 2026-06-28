-- 166: manual tax-invoice number override (Daksh, June 2026).
--
-- During the move from the old manual invoice series, the accountant can type
-- the real invoice number on a challan; the tax-invoice print + the invoices
-- list use it instead of the auto INV-<FY>-N when set. Additive + idempotent.

alter table public.challans
  add column if not exists invoice_no_override text;

notify pgrst, 'reload schema';
