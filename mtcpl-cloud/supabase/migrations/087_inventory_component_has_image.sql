-- Migration 087 — has_image flag for fast inventory loads.
-- (Daksh, June 2026)
--
-- WHY (the inventory-feels-slow fix)
-- Component photos are stored as base64 in
-- scaffolding_components.image_data_url. Every inventory page did
-- `select("*")`, which pulled those ~200 KB strings into the
-- server-rendered HTML — 1-2 MB of base64 inlined on every board /
-- add-stock load, far heavier than any other department. Now images
-- are served from a cached API route
-- (/api/inventory/component-image/[id]) and the hot-path loaders
-- select metadata ONLY. This generated column lets a query know
-- whether a component HAS an image without fetching the base64.
--
-- SAFETY: one additive generated column. No data is changed —
-- image_data_url is untouched (it stays the source the image route
-- decodes from). Nothing is deleted.

BEGIN;

ALTER TABLE public.scaffolding_components
  ADD COLUMN IF NOT EXISTS has_image BOOLEAN
    GENERATED ALWAYS AS (
      image_data_url IS NOT NULL AND image_data_url <> ''
    ) STORED;

NOTIFY pgrst, 'reload schema';
COMMIT;
