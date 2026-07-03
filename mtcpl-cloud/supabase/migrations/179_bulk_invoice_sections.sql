-- 179: Work order (bulk) invoice line items → grouped tables (Daksh, Jul 2026).
--
-- A work order invoice can now hold MORE THAN ONE table, each with its own head
-- (e.g. "PinkStone"). Items carry which table they belong to (section_index, in
-- order) and that table's head (section_head). `position` still orders rows
-- within a table. Additive + idempotent — existing single-table invoices read as
-- section_index 0 with a null head.

alter table public.bulk_invoice_items add column if not exists section_index int  not null default 0;
alter table public.bulk_invoice_items add column if not exists section_head  text;

notify pgrst, 'reload schema';
