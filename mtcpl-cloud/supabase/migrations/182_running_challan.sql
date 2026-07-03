-- 182: Running-bill two-step (Daksh, Jul 2026).
--
-- A running bill is now made in two steps: (1) create the RUNNING CHALLAN
-- (item tables with heads, NO rate/amount) from the drop, then (2) convert it to
-- an invoice by adding rate + GST. Line items reuse challan_custom_items; give
-- them the same table/head grouping as a work-order invoice (mig 179), plus a
-- flag on the challan marking the running challan as created (vs invoiced).
-- Additive + idempotent.

alter table public.challan_custom_items add column if not exists section_index int  not null default 0;
alter table public.challan_custom_items add column if not exists section_head  text;

alter table public.challans add column if not exists running_challan_at timestamptz;
alter table public.challans add column if not exists running_challan_by uuid references public.profiles(id);

notify pgrst, 'reload schema';
