-- 003_slab_requirements_description.sql
--
-- Split the old "Label / Description" combined free-text field into two
-- columns:
--
--   label       : dropdown value from slab_labels (structured, reusable)
--   description : free-text, per-slab specifics (e.g. "NE corner, set 2,
--                 1200mm"). NULL when not provided.
--
-- `label` already exists on the table — this migration only adds
-- `description`. Legacy rows keep description = NULL; on edit the user can
-- fill it in.

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ROLLBACK:
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS description;
--   -- Descriptive text on slabs is lost. Not reversible from data side.
