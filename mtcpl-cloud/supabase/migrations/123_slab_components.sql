-- ──────────────────────────────────────────────────────────────────
-- 123 — Slab temple-component category (Daksh, June 2026)
--
-- Two nullable columns so a slab can be organised inside its temple:
--   component_section — WHERE it is (a location path, "First Floor ›
--                       Cloister-2"; '›'-separated for sub-levels)
--   component_element — WHAT it is (a standardised part type: Pillar,
--                       Chajja, Beam, Ceiling, Jali, …)
--
-- Filled by AI on import (editable in the review step), powering the
-- per-temple component view later.
--
-- PURELY ADDITIVE — existing slabs are untouched (both columns default
-- NULL = "Unassigned"). Nothing is deleted or rewritten.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS component_section TEXT NULL,
  ADD COLUMN IF NOT EXISTS component_element TEXT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements
--     DROP COLUMN IF EXISTS component_section,
--     DROP COLUMN IF EXISTS component_element;
