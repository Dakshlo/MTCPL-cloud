-- ──────────────────────────────────────────────────────────────────
-- Migration 044: Scaffolding catalog — collapse to 4 + image upload
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh wants the v1 scaffolding catalog cut down to just the four
-- components that actually move through the yard:
--   • Standard
--   • Ledger
--   • Transom
--   • Jali  ← NEW (perforated screen — not in the original mig 041
--             enum, so we add it)
--
-- And he'll upload his own PNG (transparent background) per
-- component instead of the curated SVG icons. The card on the
-- inventory board picks up the uploaded image; the SVG icon stays
-- as a fallback for catalog entries that don't have an image yet.
--
-- How
-- ───
-- 1. ALTER TYPE … ADD VALUE 'jali' — runs OUTSIDE the BEGIN/COMMIT
--    block because Postgres won't allow ALTER TYPE inside a
--    transaction.
--
-- 2. New column scaffolding_components.image_data_url TEXT. The
--    UI reads the uploaded PNG as a data URL (base64) and writes
--    the entire string into this column. Avoids the Supabase
--    Storage setup for v1 — files are small (typical transparent
--    PNG icon is 10-30 KB) and there are only four of them.
--
-- 3. Archive every existing scaffolding_components row that was
--    seeded by mig 041. We don't DELETE because some of them may
--    already be referenced by inventory_movements rows from
--    Daksh's testing — archive keeps the FK intact and just hides
--    them from the new-movement picker / board.
--
-- 4. Seed the four fresh components. is_active=TRUE, no size_spec
--    (one card per type, not per size variant), unit='pcs'.
--
-- Existing inventory_movements rows are unaffected — they keep
-- pointing at the archived components, the stock math for those
-- specific (component, site) buckets still works. They just don't
-- appear in the catalog tab unless the user toggles "Show
-- archived".
-- ──────────────────────────────────────────────────────────────────

ALTER TYPE public.scaffolding_component_type ADD VALUE IF NOT EXISTS 'jali';

BEGIN;

ALTER TABLE public.scaffolding_components
  ADD COLUMN IF NOT EXISTS image_data_url TEXT NULL;

-- Archive the entire mig-041 seed. Daksh wants a clean four-tile
-- catalog. Movements that reference these archived rows still work
-- (FK preserved) but they fall off the catalog UI.
UPDATE public.scaffolding_components
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE is_active = TRUE;

-- Seed the four-component catalog. One card per type, no size
-- variants (Daksh: "just keep 4 standard / ledger / transom /
-- jali"). Display order picks the on-board left-to-right order.
INSERT INTO public.scaffolding_components
  (name, component_type, size_spec, unit, display_order, is_active)
VALUES
  ('Standard', 'standard', NULL, 'pcs', 10, TRUE),
  ('Ledger',   'ledger',   NULL, 'pcs', 20, TRUE),
  ('Transom',  'transom',  NULL, 'pcs', 30, TRUE),
  ('Jali',     'jali',     NULL, 'pcs', 40, TRUE)
ON CONFLICT (component_type, size_spec) DO UPDATE
  SET is_active = TRUE,
      name = EXCLUDED.name,
      display_order = EXCLUDED.display_order,
      updated_at = NOW();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration: upload the four PNGs through the catalog tab
-- (/inventory/scaffolding/components → Edit → file input). Each
-- saves to scaffolding_components.image_data_url and the inventory
-- board picks it up on the next refresh.
-- ──────────────────────────────────────────────────────────────────
