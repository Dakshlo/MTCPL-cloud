-- 176: "Other Sales" — non-temple challan → invoice (Daksh, Jul 2026).
--
-- The company also sells goods that have NO dispatch/temple. This adds a small
-- self-contained flow: a client (reusing invoice_parties, now with a shipping
-- block + per-client GST default), an `other_challans` document with free-typed
-- line items, and a "convert to invoice" step that stamps an INV number from the
-- SHARED per-FY INV counter (mig 168 doc_counters / next_doc_seq('INV:'+fy)), so
-- every invoice (temple + bulk + other) stays on one continuous series.
-- Additive + idempotent.

-- 1 — invoice_parties: billing city/state + a shipping block + GST default +
--     a category/head (e.g. "Maintenance & repair", "Stone wastage") for data.
alter table public.invoice_parties
  add column if not exists category        text,
  add column if not exists city            text,
  add column if not exists state           text,
  add column if not exists state_code      text,
  add column if not exists ship_name       text,
  add column if not exists ship_address    text,
  add column if not exists ship_city       text,
  add column if not exists ship_state      text,
  add column if not exists ship_state_code text,
  add column if not exists ship_gstin      text,
  add column if not exists ship_phone      text,
  add column if not exists gst_mode        text,   -- 'igst' | 'cgst_sgst' | null
  add column if not exists igst_percent    numeric,
  add column if not exists cgst_percent    numeric,
  add column if not exists sgst_percent    numeric;

-- 2 — the challan document (becomes an invoice once converted).
create table if not exists public.other_challans (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.invoice_parties(id),
  challan_date  date not null default current_date,
  doc_fy        text,           -- OC challan number: OC-<fy>-<seq>
  doc_seq       int,
  gst_mode      text,           -- 'igst' | 'cgst_sgst' | null (default from party)
  igst_percent  numeric,
  cgst_percent  numeric,
  sgst_percent  numeric,
  notes         text,
  inv_fy        text,           -- INV number, set on convert (shared INV series)
  inv_seq       int,
  converted_at  timestamptz,
  converted_by  uuid references public.profiles(id),
  cancelled_at  timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- 3 — free-typed line items (same columns as bulk_invoice_items).
create table if not exists public.other_challan_items (
  id                uuid primary key default gen_random_uuid(),
  other_challan_id  uuid not null references public.other_challans(id) on delete cascade,
  position          int not null default 0,
  particulars       text,
  hsn               text,
  unit              text,
  quantity          numeric,
  rate              numeric,
  amount            numeric
);

create index if not exists idx_other_challans_converted on public.other_challans (converted_at);
create index if not exists idx_other_challan_items_parent on public.other_challan_items (other_challan_id);

notify pgrst, 'reload schema';
