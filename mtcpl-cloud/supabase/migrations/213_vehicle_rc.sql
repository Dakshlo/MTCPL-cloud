-- 213 — Vehicles: RC number + RC expiry (Daksh, Jul 2026)
--
-- The registration certificate number and its validity date. Like the other
-- optional vehicle columns (owner 210, engine/chassis 212) the save action
-- strips them on a pre-migration deploy so nothing breaks before this runs.
-- rc_expiry joins insurance / PUC / fitness on the expiry radar; rc_no is part
-- of the vehicle-details block and lands on the timeline when changed.

alter table public.vehicles
  add column if not exists rc_no     text,
  add column if not exists rc_expiry date;

notify pgrst, 'reload schema';
