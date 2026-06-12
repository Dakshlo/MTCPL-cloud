-- ──────────────────────────────────────────────────────────────────
-- 128 — Additional Description + per-node component images (Daksh, June 2026)
-- ──────────────────────────────────────────────────────────────────
-- Two additive changes:
--
-- 1. slab_requirements.additional_description (TEXT NULL)
--    An OPTIONAL extra description on a slab. In Temple View it becomes a
--    further folder level UNDER Description — but only when it has a value
--    (empty = no extra level, slabs sit directly under Description). Same
--    "optional level" pattern Description itself already uses.
--
-- 2. temple_component_images.node_path (TEXT NULL)
--    Reference photos used to attach only at Category-1 / Category-2 nodes
--    (keyed by temple + section + element). To let a photo attach to ANY
--    tree node (Category 1, Category 2, Label, Description, Additional),
--    we key by the full tree-node path instead — e.g.
--    "OMKARESHWAR/FLOOR-1/CLOISTER/PILLAR/lotus base". Existing rows are
--    backfilled from their temple/section/element so nothing is lost.
--
-- PURELY ADDITIVE — no column is dropped, no row is deleted or rewritten
-- beyond the one-time node_path backfill (which only fills NULLs).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Optional additional description on slabs.
ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS additional_description TEXT NULL;

-- 2. Full node-path key for component images (any tree level).
ALTER TABLE public.temple_component_images
  ADD COLUMN IF NOT EXISTS node_path TEXT NULL;

-- Backfill node_path for existing rows from temple/section[/element]. This
-- matches the tree-node id the app builds for Category-1 / Category-2 nodes
-- (the only levels images could attach to before this migration).
UPDATE public.temple_component_images
   SET node_path = CASE
     WHEN element IS NOT NULL AND btrim(element) <> ''
       THEN temple || '/' || section || '/' || element
     ELSE temple || '/' || section
   END
 WHERE node_path IS NULL;

CREATE INDEX IF NOT EXISTS temple_component_images_node_path_idx
  ON public.temple_component_images (node_path);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS additional_description;
--   DROP INDEX IF EXISTS public.temple_component_images_node_path_idx;
--   ALTER TABLE public.temple_component_images DROP COLUMN IF EXISTS node_path;
