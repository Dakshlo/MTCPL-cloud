-- Dispatch lifecycle v2 — provisional approval step + human-friendly
-- challan numbers.
--
-- Adds:
--   1. `challan_number INT UNIQUE` auto-assigned from a sequence so every
--      dispatch has a monotonic human-readable ID (CHLN-0001, CHLN-0002, …)
--      instead of the current `DISP-{8-char UUID prefix}`.
--   2. `approved_at TIMESTAMPTZ`, `approved_by UUID` — NULL means the
--      dispatch is still "provisional" (awaiting senior approval). Once
--      set, the row becomes "out for delivery" (same as today). Delivered
--      remains `delivered_at IS NOT NULL`.
--
-- Idempotent — every ALTER / CREATE guards with IF NOT EXISTS or
-- equivalent. Running twice is a no-op.
--
-- Backfill strategy:
--   - Existing rows are GRANDFATHERED as already-approved (they were
--     created before this step existed), so nothing that's currently
--     mid-flight gets retroactively sent back to Provisional.
--   - Challan numbers are backfilled in creation order so row #1 is the
--     oldest dispatch in the DB.

BEGIN;

-- ─── 1. Sequential challan numbers ─────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.dispatches_challan_seq START WITH 1;

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS challan_number INT;

-- Backfill in creation order so #1 = oldest. ROW_NUMBER() is deterministic
-- when ordered by (created_at, id) — id is a tie-breaker for same-second rows.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
  FROM public.dispatches
  WHERE challan_number IS NULL
)
UPDATE public.dispatches d
  SET challan_number = n.n
  FROM numbered n
  WHERE d.id = n.id;

-- Advance the sequence past the backfilled values so future INSERTs pick up
-- from N+1. GREATEST with 0 defends against the empty-table case.
SELECT setval(
  'public.dispatches_challan_seq',
  GREATEST(COALESCE((SELECT MAX(challan_number) FROM public.dispatches), 0), 1),
  true
);

-- From this point on, every INSERT auto-populates challan_number from the
-- sequence. Also make the column NOT NULL — after backfill nothing should
-- ever be missing.
ALTER TABLE public.dispatches
  ALTER COLUMN challan_number SET DEFAULT nextval('public.dispatches_challan_seq'),
  ALTER COLUMN challan_number SET NOT NULL;

-- UNIQUE constraint — challan numbers must never collide. Sequence already
-- prevents this but the constraint makes it a hard DB-level guarantee.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dispatches_challan_number_unique'
  ) THEN
    ALTER TABLE public.dispatches
      ADD CONSTRAINT dispatches_challan_number_unique UNIQUE (challan_number);
  END IF;
END $$;

-- ─── 2. Provisional approval columns ──────────────────────────────────

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);

-- Grandfather every existing dispatch as already-approved. They were
-- created before the approval step existed and are likely mid-flight or
-- already delivered — retroactively marking them as "pending approval"
-- would be confusing.
UPDATE public.dispatches
  SET approved_at = dispatched_at,
      approved_by = dispatched_by
  WHERE approved_at IS NULL;

-- Partial index for the Provisional tab's query
-- (approved_at IS NULL AND delivered_at IS NULL — in practice, just the
--  first predicate since delivered_at can only be set after approval).
CREATE INDEX IF NOT EXISTS dispatches_provisional_idx
  ON public.dispatches(dispatched_at DESC)
  WHERE approved_at IS NULL;

COMMIT;
