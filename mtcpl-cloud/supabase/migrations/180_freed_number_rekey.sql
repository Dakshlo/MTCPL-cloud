-- 180: Free CHALLAN numbers too (Daksh, Jul 2026).
--
-- freed_invoice_numbers now holds freed numbers for BOTH series, keyed by the
-- doc_counters key: 'INV:<fy>' for invoices, '<fy>' for challans. Legacy invoice
-- rows were stored with a bare '<fy>' (mig 178) — re-key them to 'INV:<fy>' so
-- they don't collide with the new challan-number rows. Idempotent.

update public.freed_invoice_numbers
   set fy = 'INV:' || fy
 where fy !~ '^INV:';

notify pgrst, 'reload schema';
