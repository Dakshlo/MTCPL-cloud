-- 184: Invoice change requests — approval-gated edit & cancel (Daksh, Jul 2026).
--
-- Once an invoice exists (priced challan, running bill, work-order bulk, or
-- other-sales), editing or cancelling it no longer applies immediately: it is
-- STAGED as a pending request that owner / accountant★ approve or reject on the
-- Approval page. Approve → the change is applied; reject → nothing changes.
--   • pending_edit_payload holds the proposed new state (rates / items / GST /
--     transport / linked challans) as JSON.
--   • pending_cancel_at marks a cancel request.
-- Purchase + running invoices live on `challans`; work-order on `bulk_invoices`;
-- other-sales on `other_challans`. Additive + idempotent.

alter table public.challans        add column if not exists pending_edit_at      timestamptz;
alter table public.challans        add column if not exists pending_edit_by      uuid references public.profiles(id);
alter table public.challans        add column if not exists pending_edit_payload jsonb;
alter table public.challans        add column if not exists pending_cancel_at     timestamptz;
alter table public.challans        add column if not exists pending_cancel_by     uuid references public.profiles(id);

alter table public.bulk_invoices   add column if not exists pending_edit_at      timestamptz;
alter table public.bulk_invoices   add column if not exists pending_edit_by      uuid references public.profiles(id);
alter table public.bulk_invoices   add column if not exists pending_edit_payload jsonb;
alter table public.bulk_invoices   add column if not exists pending_cancel_at     timestamptz;
alter table public.bulk_invoices   add column if not exists pending_cancel_by     uuid references public.profiles(id);

alter table public.other_challans  add column if not exists pending_edit_at      timestamptz;
alter table public.other_challans  add column if not exists pending_edit_by      uuid references public.profiles(id);
alter table public.other_challans  add column if not exists pending_edit_payload jsonb;
alter table public.other_challans  add column if not exists pending_cancel_at     timestamptz;
alter table public.other_challans  add column if not exists pending_cancel_by     uuid references public.profiles(id);

notify pgrst, 'reload schema';
