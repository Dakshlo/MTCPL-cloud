-- 173: Bulk invoices — one tax invoice covering MANY challans (Daksh, June 2026).
--
-- Some clients don't invoice each delivery; they collect challans and bill them
-- together periodically. So an OPEN challan can be "sent to bulk" (leaves the
-- Challans page → Bulk page). From there the accountant creates ONE tax invoice
-- for a temple covering several of its bulk challans, with MANUAL line items
-- (particulars / HSN / unit / qty / rate / amount). The challans are only LINKED
-- (referenced on the bill), not copied. Bulk invoices share the INV-<fy>-N series
-- (mig 172) and go through the SAME owner approval as single invoices.
-- Additive + idempotent.

alter table public.challans
  add column if not exists sent_to_bulk_at timestamptz;

create table if not exists public.bulk_invoices (
  id                  uuid primary key default gen_random_uuid(),
  temple              text not null,
  invoice_date        date not null default current_date,
  inv_fy              text,
  inv_seq             int,
  invoice_no_override text,
  gst_mode            text,
  igst_percent        numeric,
  cgst_percent        numeric,
  sgst_percent        numeric,
  notes               text,
  owner_approved_at   timestamptz,
  owner_approved_by   uuid references public.profiles(id),
  owner_rejected_at   timestamptz,
  owner_reject_reason text,
  cancelled_at        timestamptz,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now()
);

create table if not exists public.bulk_invoice_items (
  id              uuid primary key default gen_random_uuid(),
  bulk_invoice_id uuid not null references public.bulk_invoices(id) on delete cascade,
  position        int  not null default 0,
  particulars     text,
  hsn             text,
  unit            text,
  quantity        numeric,
  rate            numeric,
  amount          numeric
);

create table if not exists public.bulk_invoice_challans (
  bulk_invoice_id uuid not null references public.bulk_invoices(id) on delete cascade,
  challan_id      uuid not null references public.challans(id),
  primary key (bulk_invoice_id, challan_id)
);

notify pgrst, 'reload schema';
