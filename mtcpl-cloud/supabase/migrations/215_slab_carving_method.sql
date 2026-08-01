-- ──────────────────────────────────────────────────────────────────
-- 215 — Slab carving method tag (Daksh, Aug 2026)
--
-- Mohit — the one person who decided each slab's carving route (CNC vs
-- outsource jobwork vs no carving / direct dispatch) — is unwell, and
-- nobody else knows what to assign where. The decision now lives ON the
-- slab, recorded when the requirement is added and editable later:
--
--   carving_method = 'cnc'       → carve on our CNC machines
--                    'outsource' → jobwork / outside carvers
--                    'none'      → no carving, cut → straight to dispatch
--                    NULL        → "nil" — undecided / any (default)
--
-- GUIDE, not gate: assignment screens show the tag and warn on a
-- mismatch but never block. The /carving/plan dashboard reads this
-- column for per-method load + the CNC capacity forecast.
--
-- BACKFILL: historical slabs are classified from what actually happened
-- (direct-dispatched → none; carved via carving_items → cnc/outsource by
-- vendor_type). Whatever remains NULL is the real undecided pile.
-- PURELY ADDITIVE — no status/enum change; re-runnable (all updates are
-- guarded on carving_method IS NULL).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS carving_method TEXT NULL;

-- Idempotent CHECK (same pattern as mig 088).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slab_requirements_carving_method_chk'
  ) THEN
    ALTER TABLE public.slab_requirements
      ADD CONSTRAINT slab_requirements_carving_method_chk
      CHECK (carving_method IS NULL OR carving_method IN ('cnc', 'outsource', 'none'));
  END IF;
END $$;

-- Partial index — only tagged rows are indexed (most rows start NULL).
CREATE INDEX IF NOT EXISTS slab_requirements_carving_method_idx
  ON public.slab_requirements (carving_method) WHERE carving_method IS NOT NULL;

-- ── Backfill from actuals ───────────────────────────────────────────
-- 1. Direct-dispatched slabs skipped carving entirely → 'none'.
--    (direct_dispatched_at exists since mig 130.)
UPDATE public.slab_requirements
   SET carving_method = 'none'
 WHERE carving_method IS NULL
   AND direct_dispatched_at IS NOT NULL;

-- 2. Slabs with a carving job → method from the vendor type of their
--    newest non-cancelled carving_item. slab_requirement_id is UNIQUE in
--    the base schema; DISTINCT ON is belt-and-braces in case prod ever
--    relaxed that.
UPDATE public.slab_requirements AS s
   SET carving_method = CASE WHEN ci.vendor_type = 'CNC' THEN 'cnc' ELSE 'outsource' END
  FROM (
    SELECT DISTINCT ON (slab_requirement_id)
           slab_requirement_id, vendor_type
      FROM public.carving_items
     WHERE status <> 'cancelled'
     ORDER BY slab_requirement_id, assigned_at DESC NULLS LAST
  ) AS ci
 WHERE s.id = ci.slab_requirement_id
   AND s.carving_method IS NULL;

-- 3. Everything else stays NULL — the genuine undecided queue.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual — loses the recorded routing decisions):
--   ALTER TABLE public.slab_requirements DROP CONSTRAINT IF EXISTS slab_requirements_carving_method_chk;
--   DROP INDEX IF EXISTS slab_requirements_carving_method_idx;
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS carving_method;
