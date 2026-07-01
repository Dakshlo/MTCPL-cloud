-- 175: Bulk-challan "full challan" (transport captured) + dispatch release mode.
--
-- New bulk flow (Daksh): a bulk challan is billed much later, so the delivery
-- challan handed to the truck driver needs transport details captured up front.
-- "Get challan" fills transport → full_challan_at stamps the challan (Tab-2 =
-- ready for the driver) and the linked dispatch is released On-the-road with
-- release_mode='challan' (goods leave on the challan, no invoice yet). The
-- invoice release path (single convert → owner approve) sets release_mode=
-- 'invoice'. Additive + idempotent.

alter table public.challans
  add column if not exists full_challan_at timestamptz,
  add column if not exists full_challan_by uuid;

alter table public.dispatches
  add column if not exists release_mode text;  -- 'challan' | 'invoice'

create index if not exists idx_challans_full_challan_at on public.challans (full_challan_at);

notify pgrst, 'reload schema';
