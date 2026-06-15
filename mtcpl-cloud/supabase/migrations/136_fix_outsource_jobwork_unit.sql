-- 136 — Fix the jobwork_unit snapshot on outsource carving jobs.
-- Before the send fix, a 'job' (flat-per-slab) work order had its slabs sent
-- with unit collapsed to 'cft', so challans charged cft × rate (e.g. ₹4.63)
-- instead of the flat rate (e.g. ₹1000). Backfill each Outsource carving_item
-- to match its work order's unit. (Already-generated challans are frozen —
-- cancel + regenerate those to pick up the corrected amounts.)

begin;

update public.carving_items ci
set jobwork_unit = wo.jobwork_unit
from public.carving_work_order_items cwoi
join public.carving_work_orders wo on wo.id = cwoi.work_order_id
where cwoi.carving_item_id = ci.id
  and ci.vendor_type = 'Outsource'
  and wo.jobwork_unit is not null
  and ci.jobwork_unit is distinct from wo.jobwork_unit;

commit;

notify pgrst, 'reload schema';
