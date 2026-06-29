-- 169: Transportation details on the tax invoice (Daksh, June 2026).
--
-- The accountant enters transport details when pricing a challan; they print in
-- a "Transportation" card under Bill To / Ship To. The company is a reusable
-- master (a datalist on the review form) — typing a new one auto-adds it.
-- Additive + idempotent; all TEXT.

create table if not exists public.transport_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.challans
  add column if not exists transport_company      text,
  add column if not exists transport_phone        text,
  add column if not exists lr_no                  text,
  add column if not exists transport_vehicle_no   text,
  add column if not exists transport_driver_name  text,
  add column if not exists transport_driver_phone text;

notify pgrst, 'reload schema';
