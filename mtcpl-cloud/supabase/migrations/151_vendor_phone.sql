-- ──────────────────────────────────────────────────────────────────
-- 151 — Vendor contact phone (Daksh, June 2026)
--
-- Shown on the Slab Transfer vendor cards so the runner can call the
-- shade. PURELY ADDITIVE — one nullable column, seeded for the three
-- known CNC vendors. Edit/add later in vendor management.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS phone TEXT NULL;

UPDATE public.vendors SET phone = '9352016785' WHERE name ILIKE '%mohit%'   AND phone IS NULL;
UPDATE public.vendors SET phone = '9602273033' WHERE name ILIKE '%manthan%' AND phone IS NULL;
UPDATE public.vendors SET phone = '7014716693' WHERE name ILIKE '%vivek%'   AND phone IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
