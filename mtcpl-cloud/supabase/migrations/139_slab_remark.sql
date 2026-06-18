-- ──────────────────────────────────────────────────────────────────
-- 139 — Per-slab free-text remark (Daksh, June 2026)
-- ──────────────────────────────────────────────────────────────────
-- slab_requirements.remark (TEXT NULL)
--   A free-text note the office can type against any individual slab,
--   edited inline from the new Temple View table (card ⇄ table toggle at
--   the slab leaf). Every other table column is read-only; this is the
--   one writable field. Distinct from the purpose-bound notes already on
--   the table (depart_note, pending_work_note, install_note, cancel_reason)
--   — this is a general-purpose remark with no workflow meaning.
--
-- PURELY ADDITIVE — no column dropped, no row rewritten.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS remark TEXT NULL;

COMMIT;

-- Tell PostgREST to reload the schema cache so the new column is queryable.
NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS remark;
