-- 181: Archive (retire) a challan without invoicing it (Daksh, Jul 2026).
--
-- Some challans were created while testing the dispatch→invoice module. Their
-- slabs have already physically left the plant, so we can't cancel them (that
-- would send slabs back to Make Dispatch) and we don't want to invoice them
-- (that would burn an INV number). "Archive" hides the challan from Invoicing
-- AND hides its dispatch from every dispatch lane — slabs stay dispatched, no
-- invoice, no number consumed. Additive + idempotent.

alter table public.challans   add column if not exists archived_at  timestamptz;
alter table public.challans   add column if not exists archived_by  uuid references public.profiles(id);
alter table public.dispatches add column if not exists archived_at  timestamptz;
alter table public.dispatches add column if not exists archived_by  uuid references public.profiles(id);

notify pgrst, 'reload schema';
