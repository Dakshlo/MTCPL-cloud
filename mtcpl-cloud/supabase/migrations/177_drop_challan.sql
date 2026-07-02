-- 177: "Drop the challan" → custom whole-piece temple bill (Daksh, Jul 2026).
--
-- Some temple clients negotiate a "whole piece" deal: we manufacture + ship every
-- component (slabs) but bill as a single PC in the client's own format. Instead of
-- an Other-Sales bill (slabs never leave the yard) or a bulk detour, the operator
-- makes the SAME production dispatch → its invoicing challan lands on the Challans
-- page → they DROP it (drag onto a new drop zone) → re-bill it as a custom bill
-- with free line items, KEEPING the original CH number. Creating the custom bill
-- releases the production dispatch straight to Delivered (skipping On-the-road), so
-- the slabs leave "ready to dispatch". The custom bill can then become a tax invoice.
-- Additive + idempotent. (challans already has gst_mode/*_percent [mig 157],
-- inv_fy/inv_seq [mig 172], doc_fy/doc_seq [mig 168], temple, source_dispatch_id.)

alter table public.challans
  add column if not exists dropped_at       timestamptz,
  add column if not exists dropped_by       uuid references public.profiles(id),
  add column if not exists custom_billed_at timestamptz,
  add column if not exists custom_billed_by uuid references public.profiles(id);

-- Free-typed line items for a dropped challan's custom bill (same shape as the
-- other/bulk item tables).
create table if not exists public.challan_custom_items (
  id          uuid primary key default gen_random_uuid(),
  challan_id  uuid not null references public.challans(id) on delete cascade,
  position    int  not null default 0,
  particulars text,
  hsn         text,
  unit        text,
  quantity    numeric,
  rate        numeric,
  amount      numeric
);

create index if not exists idx_challan_custom_items_parent on public.challan_custom_items (challan_id);
create index if not exists idx_challans_dropped_at on public.challans (dropped_at);

notify pgrst, 'reload schema';
