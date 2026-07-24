-- 212 — Vehicles: engine number + chassis number (Daksh, Jul 2026)
--
-- Two more identity fields on the Vehicle details card. Like owner_name (210)
-- they're optional text; the save action strips them on a pre-migration deploy
-- so nothing breaks before this runs. Both are part of the identity lock
-- (mig 211): read-only after creation for everyone except the developer, and
-- changes land on the vehicle timeline.

alter table public.vehicles
  add column if not exists engine_no  text,
  add column if not exists chassis_no text;

notify pgrst, 'reload schema';
