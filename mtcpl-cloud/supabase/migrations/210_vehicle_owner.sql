-- 210 — Vehicles: owner field (Daksh, Jul 2026)
--
-- "in adding vehicle add owner field" — whose name the vehicle / RC is
-- registered under. Free text, optional; shows on the vehicle card and in the
-- Add / Edit form. The save action falls back gracefully pre-migration, so a
-- deploy before this runs simply saves without the owner.

alter table public.vehicles
  add column if not exists owner_name text;

notify pgrst, 'reload schema';
