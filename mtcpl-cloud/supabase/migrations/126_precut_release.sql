-- ──────────────────────────────────────────────────────────────────
-- 126 — Pre-cut / provisional slab release (Daksh, June 2026)
--
-- The cutting↔carving gap fix we designed: a big block takes days to
-- finish, but its first slabs are physically cut (and taken by carving)
-- on day one. Pre-cut lets the office release ALREADY-CUT planned slabs
-- early: they flip to status='cut_done' (so carving can assign them)
-- with a precut stamp, while the block stays In Progress. The final
-- Cutting Done + audit happens later as normal — pre-cut slabs show
-- locked there, and the audit card is coloured so the auditor knows.
-- When the block is finally approved 'done', the precut stamp clears
-- (cards stop blinking / tinting everywhere).
--
-- PURELY ADDITIVE — no enum change, no existing data touched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS precut_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS precut_by UUID NULL REFERENCES public.profiles(id);

-- Partial index — only the (few) live pre-cut rows are indexed.
CREATE INDEX IF NOT EXISTS slab_requirements_precut_idx
  ON public.slab_requirements (precut_at) WHERE precut_at IS NOT NULL;

ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS precut_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_precut_at TIMESTAMPTZ NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements
--     DROP COLUMN IF EXISTS precut_at, DROP COLUMN IF EXISTS precut_by;
--   ALTER TABLE public.cut_session_blocks
--     DROP COLUMN IF EXISTS precut_count, DROP COLUMN IF EXISTS last_precut_at;
