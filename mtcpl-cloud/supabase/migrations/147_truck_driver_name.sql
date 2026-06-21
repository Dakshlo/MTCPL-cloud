-- ──────────────────────────────────────────────────────────────────
-- 147 — Driver name on transfer trucks (Daksh, June 2026)
--
-- Trucks (mig 144) are managed in Settings by number plate. Add an
-- optional driver name so the slab-transfer runner sees who's driving
-- when picking a truck on claim. PURELY ADDITIVE — one nullable column.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS driver_name TEXT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
