-- 135 — Soft-hide cancelled / rejected work orders from the Outsource list.
-- Daksh: cancelled work-order cards "just sit there" — let owner/dev remove
-- them from the list without deleting the record (audit stays intact).
-- Additive + idempotent.

begin;

alter table public.carving_work_orders
  add column if not exists dismissed_at timestamptz;
alter table public.carving_work_orders
  add column if not exists dismissed_by uuid references public.profiles(id);

commit;

notify pgrst, 'reload schema';
