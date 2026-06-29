-- 170: default GST per temple-as-client (Daksh, June 2026).
--
-- The GST treatment (none / IGST / CGST+SGST) and its rate are a property of the
-- client, so they're set once on the temple in Settings → Temple Codes and then
-- PRE-SELECTED on the invoicing "Review & price" page (still editable there).
-- Additive + idempotent.

alter table public.temples
  add column if not exists gst_mode      text,   -- 'igst' | 'cgst_sgst' | null/none
  add column if not exists igst_percent  numeric,
  add column if not exists cgst_percent  numeric,
  add column if not exists sgst_percent  numeric;

notify pgrst, 'reload schema';
