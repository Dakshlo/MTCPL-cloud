-- ──────────────────────────────────────────────────────────────────
-- 125 — Slab temporary storage ("park") flag (Daksh, June 2026)
--
-- Lets owner / developer / carving_head move cut-done slabs that are
-- "ready to assign to carving" into a temporary Storage so they stop
-- cluttering the carving Unassigned list (a big historical backlog that
-- was, in reality, already carved & shipped before carving was tracked).
-- Parked slabs keep status='cut_done' — NOTHING else changes — they're
-- just hidden from the assign list. Bringing one back clears the flag.
--
-- PURELY ADDITIVE — existing slabs are untouched (is_parked defaults
-- false). No status / enum change, no data rewritten.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS is_parked   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parked_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS parked_by   UUID NULL REFERENCES public.profiles(id);

-- Partial index — only the (few) parked rows are indexed.
CREATE INDEX IF NOT EXISTS slab_requirements_parked_idx
  ON public.slab_requirements (is_parked) WHERE is_parked = true;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements
--     DROP COLUMN IF EXISTS is_parked,
--     DROP COLUMN IF EXISTS parked_at,
--     DROP COLUMN IF EXISTS parked_by;
