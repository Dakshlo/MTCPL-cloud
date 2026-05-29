-- ──────────────────────────────────────────────────────────────────
-- Mig 079 — CNC axis subtypes (3 / 4 / 5-axis)
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 — until now MTCPL only had 3-axis CNCs (the
-- "multi_head_2" type in mig 021). Daksh added 4-axis and 5-axis
-- CNCs to the floor and we need the system to know which vendor
-- has what, and which slabs require what.
--
-- Constraints (carved into stone by Daksh himself):
--   • 4-axis and 5-axis machines are also DOUBLE-HEADED — same
--     pairing logic as the 3-axis multi_head_2 (machine_type
--     stays 'multi_head_2'; this is purely an axis-count facet).
--   • "Default / Any CNC" is the assign-time default — keeps the
--     current behaviour (a CNC slab can land on any CNC machine)
--     unless the assigner explicitly picks 4-axis or 5-axis.
--   • Vendor cockpit enforces a STRICT MATCH on load: a slab
--     marked 4-axis can ONLY load on a 4-axis machine, never on a
--     3 or 5. (Daksh's spec — not >= semantics. Hardware-axis
--     mismatches damage tooling.)
--
-- Schema posture:
--   • Two new columns, both NULLABLE, both gated. Existing rows
--     get sensible defaults that preserve current behaviour:
--       cnc_machines.cnc_axes        — backfilled to 3 for every
--                                      existing CNC machine; NULL
--                                      stays NULL for Lathe.
--       carving_items.requires_cnc_axes — stays NULL on every
--                                      existing row → "Any CNC"
--                                      → matches current behaviour
--                                      → zero data drift.
--
-- Production-data safety:
--   • All changes are ADD COLUMN + UPDATE for the backfill. No
--     rows are dropped, no columns renamed.
--   • All CHECK constraints accept NULL so the migration doesn't
--     reject existing data.
--   • Idempotent — re-running on a stage env that already had it
--     is a no-op for the column adds (ALTER TABLE … IF NOT EXISTS)
--     and the backfill UPDATE only touches rows still at NULL.

BEGIN;

-- ── 1. cnc_machines.cnc_axes ────────────────────────────────────
-- 3 = 3-axis (the current default for every CNC on the floor),
-- 4 = 4-axis (new), 5 = 5-axis (new). NULL = not applicable
-- (Lathe machines, future machine types). The CHECK accepts NULL
-- so Lathe rows pass through unchanged.
ALTER TABLE public.cnc_machines
  ADD COLUMN IF NOT EXISTS cnc_axes SMALLINT NULL
    CHECK (cnc_axes IS NULL OR cnc_axes IN (3, 4, 5));

-- Backfill: every existing CNC machine (single_head, multi_head_2)
-- gets cnc_axes = 3 because that's what Daksh has on the floor
-- today. Lathe rows are intentionally NOT touched (they keep
-- cnc_axes = NULL — axis count doesn't apply to lathes). The
-- `WHERE cnc_axes IS NULL` guard makes the backfill idempotent.
UPDATE public.cnc_machines
   SET cnc_axes = 3
 WHERE machine_type IN ('single_head', 'multi_head_2')
   AND cnc_axes IS NULL;

-- ── 2. carving_items.requires_cnc_axes ──────────────────────────
-- NULL = "Any CNC" (default — matches the existing assign flow's
-- behaviour; a non-lathe slab lands on any CNC machine).
-- 4 = "Must be 4-axis", 5 = "Must be 5-axis". 3 is NOT a valid
-- value here — if the assigner wants 3-axis specifically they can
-- pick "Any" and let routing handle it; "3-axis only" wasn't
-- requested. The CHECK accepts NULL so every existing row passes
-- through unchanged.
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS requires_cnc_axes SMALLINT NULL
    CHECK (requires_cnc_axes IS NULL OR requires_cnc_axes IN (4, 5));

-- No backfill needed for carving_items — leaving them at NULL
-- means "Any CNC", which is exactly the behaviour they had before
-- this column existed. Zero data drift.

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- Every existing CNC machine should now have cnc_axes = 3.
--   -- Lathes should stay NULL.
--   SELECT machine_type, cnc_axes, COUNT(*)
--     FROM cnc_machines
--    GROUP BY machine_type, cnc_axes
--    ORDER BY 1, 2;
--
--   -- Every existing carving_items row should have
--   -- requires_cnc_axes = NULL.
--   SELECT requires_cnc_axes, COUNT(*)
--     FROM carving_items
--    GROUP BY 1
--    ORDER BY 1 NULLS FIRST;
-- ──────────────────────────────────────────────────────────────────
