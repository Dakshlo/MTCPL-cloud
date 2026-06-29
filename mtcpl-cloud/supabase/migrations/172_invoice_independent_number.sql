-- 172: invoice number INDEPENDENT of the challan number (Daksh, June 2026).
--
-- Until now a priced challan's tax-invoice code reused the challan's per-FY
-- number (CH-26/27-10 → INV-26/27-10). Daksh wants the two to run their OWN
-- series. So a challan now gets its own invoice number (inv_fy / inv_seq),
-- assigned ONCE when it is first priced, drawn from a separate FY counter
-- ("INV:<fy>" key in doc_counters — shared by future bulk invoices too).
-- Additive + idempotent.

alter table public.challans
  add column if not exists inv_fy  text,
  add column if not exists inv_seq int;

notify pgrst, 'reload schema';
