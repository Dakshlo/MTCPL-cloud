-- 183: Other Sales challan tables/heads (Daksh, Jul 2026).
--
-- Other Sales now mirrors the running-bill two-step: the CHALLAN is item tables
-- with heads (NO rate), then a full-screen convert adds rate + GST → invoice.
-- Line items reuse other_challan_items; give them the same table/head grouping
-- as a work-order invoice (mig 179). Additive + idempotent.

alter table public.other_challan_items add column if not exists section_index int  not null default 0;
alter table public.other_challan_items add column if not exists section_head  text;

notify pgrst, 'reload schema';
