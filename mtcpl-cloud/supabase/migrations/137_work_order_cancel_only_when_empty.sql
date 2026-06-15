-- 137 — A work order is only 'cancelled' when nothing is left in it.
-- Older cancels marked the WO cancelled even though slabs were still out at
-- the vendor. Re-derive any such WO: completed if every active line is
-- approved, else in_progress; and clear the cancelled flags.

begin;

update public.carving_work_orders wo
set
  status = case
    when not exists (
      select 1
      from public.carving_work_order_items i
      left join public.carving_items ci on ci.id = i.carving_item_id
      where i.work_order_id = wo.id
        and i.line_status <> 'cancelled'
        and (i.carving_item_id is null or ci.review_approved_at is null)
    ) then 'completed'
    else 'in_progress'
  end,
  cancelled_at = null,
  cancel_reason = null,
  updated_at = now()
where wo.status = 'cancelled'
  and exists (
    select 1 from public.carving_work_order_items i
    where i.work_order_id = wo.id and i.line_status <> 'cancelled'
  );

commit;

notify pgrst, 'reload schema';
