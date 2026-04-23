-- Merge the two known vendor-name duplicate pairs into one canonical
-- UPPERCASE form. After this, the Block Report vendor filter shows one
-- entry per vendor instead of two.
--
-- Idempotent — running twice is a no-op because the WHERE clauses
-- exclude rows already matching the canonical form.
--
-- Also: `vendors.name` has a UNIQUE constraint, so if the canonical
-- row already exists we DELETE the non-canonical row; otherwise we
-- UPDATE it into the canonical form. Both branches are covered.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. "Ansu Marble" / "ansu marble" / any casing → "ANSU MARBLE"
--    across blocks, marble_truck_entries, and vendors.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.blocks
  SET vendor_name = 'ANSU MARBLE', updated_at = now()
  WHERE vendor_name IS NOT NULL
    AND UPPER(TRIM(vendor_name)) = 'ANSU MARBLE'
    AND vendor_name <> 'ANSU MARBLE';

UPDATE public.marble_truck_entries
  SET vendor_name = 'ANSU MARBLE'
  WHERE vendor_name IS NOT NULL
    AND UPPER(TRIM(vendor_name)) = 'ANSU MARBLE'
    AND vendor_name <> 'ANSU MARBLE';

-- If the canonical "ANSU MARBLE" row already exists in vendors, delete
-- every non-canonical variant (keeps the unique constraint happy).
DELETE FROM public.vendors
  WHERE UPPER(TRIM(name)) = 'ANSU MARBLE'
    AND name <> 'ANSU MARBLE'
    AND EXISTS (SELECT 1 FROM public.vendors WHERE name = 'ANSU MARBLE');

-- Else rename the lone non-canonical row into place.
UPDATE public.vendors
  SET name = 'ANSU MARBLE'
  WHERE UPPER(TRIM(name)) = 'ANSU MARBLE'
    AND name <> 'ANSU MARBLE';

-- ─────────────────────────────────────────────────────────────────────
-- 2. "Y K STONE" / "y k stone" / "Y K  STONE" → "YK STONE"
--    Space-insensitive compare, so "Y K STONE" matches "YKSTONE" via
--    REPLACE(...,' ','').
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.blocks
  SET vendor_name = 'YK STONE', updated_at = now()
  WHERE vendor_name IS NOT NULL
    AND REPLACE(UPPER(TRIM(vendor_name)), ' ', '') = 'YKSTONE'
    AND vendor_name <> 'YK STONE';

UPDATE public.marble_truck_entries
  SET vendor_name = 'YK STONE'
  WHERE vendor_name IS NOT NULL
    AND REPLACE(UPPER(TRIM(vendor_name)), ' ', '') = 'YKSTONE'
    AND vendor_name <> 'YK STONE';

DELETE FROM public.vendors
  WHERE REPLACE(UPPER(TRIM(name)), ' ', '') = 'YKSTONE'
    AND name <> 'YK STONE'
    AND EXISTS (SELECT 1 FROM public.vendors WHERE name = 'YK STONE');

UPDATE public.vendors
  SET name = 'YK STONE'
  WHERE REPLACE(UPPER(TRIM(name)), ' ', '') = 'YKSTONE'
    AND name <> 'YK STONE';

COMMIT;
