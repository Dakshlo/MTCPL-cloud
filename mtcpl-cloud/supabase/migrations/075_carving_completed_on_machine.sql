-- ──────────────────────────────────────────────────────────────────
-- Mig 075 — carving_items.completed_on_cnc_machine_id
-- ──────────────────────────────────────────────────────────────────
--
-- The CNC monthly report (src/lib/cnc-monthly-report.ts) used to
-- group completed slabs by carving_items.cnc_machine_id. That column
-- was always set on completion because the original completeAndUnload
-- path stamped completed_at but left cnc_machine_id pointing at the
-- machine. The report's
--
--     .gte("completed_at", startIso)
--     .lt("completed_at", endIso)
--     .not("cnc_machine_id", "is", null)
--
-- query then found every completed item with its machine attribution
-- intact.
--
-- Daksh May 2026 — that flow broke the cockpit (commit ce01026):
-- after marking 2 slabs complete on CNC 22 the cockpit kept showing
-- them on the machine card because activeByMachine grouped on
-- cnc_machine_id. The one-line fix added `cnc_machine_id: null` to
-- completeAndUnloadAction's UPDATE so the cockpit reads cleanly.
-- That also broke the report: every newly-completed item now drops
-- out of the .not("cnc_machine_id","is",null) filter, so the May
-- 2026 report came back all zeros.
--
-- This migration preserves the machine attribution explicitly:
--
--   completed_on_cnc_machine_id — set when the slab is marked
--   complete, never cleared. The report keys on this column going
--   forward; the cockpit keeps reading cnc_machine_id (set only
--   while the slab is physically on a machine).
--
-- Backfill below covers three classes of historical rows:
--
--   (a) Completed BEFORE ce01026 → cnc_machine_id is still set;
--       copy it across.
--   (b) Completed AFTER ce01026 via completeAndUnload → cnc_machine_id
--       was cleared; look up the most-recent 'unloaded' event in
--       cnc_machine_events (the unload event preserves cnc_machine_id
--       on the audit row even though the carving_items column is
--       null now).
--   (c) Completed from hold via completeHeldSlabAction → never had
--       an 'unloaded' event because the hold path doesn't write one.
--       Fall back to held_from_machine_id which the hold action
--       preserves through reload cycles.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS completed_on_cnc_machine_id UUID NULL
    REFERENCES public.cnc_machines(id) ON DELETE SET NULL;

-- (a) Completed-before-ce01026 backfill: cnc_machine_id is still set.
UPDATE public.carving_items
   SET completed_on_cnc_machine_id = cnc_machine_id
 WHERE completed_at IS NOT NULL
   AND cnc_machine_id IS NOT NULL
   AND completed_on_cnc_machine_id IS NULL;

-- (b) Cleared-on-complete backfill: look up the latest 'unloaded'
-- event for each carving_item that's completed but has no machine
-- attribution yet. Subquery + LATERAL avoids the slow N+1.
UPDATE public.carving_items ci
   SET completed_on_cnc_machine_id = e.cnc_machine_id
  FROM (
    SELECT DISTINCT ON (carving_item_id)
           carving_item_id, cnc_machine_id
      FROM public.cnc_machine_events
     WHERE event_type = 'unloaded'
       AND carving_item_id IS NOT NULL
     ORDER BY carving_item_id, created_at DESC
  ) e
 WHERE ci.id = e.carving_item_id
   AND ci.completed_at IS NOT NULL
   AND ci.completed_on_cnc_machine_id IS NULL;

-- (c) Completed-from-hold backfill: hold path doesn't emit an
-- 'unloaded' event, so fall back to held_from_machine_id which the
-- hold action records.
UPDATE public.carving_items
   SET completed_on_cnc_machine_id = held_from_machine_id
 WHERE completed_at IS NOT NULL
   AND completed_on_cnc_machine_id IS NULL
   AND held_from_machine_id IS NOT NULL;

-- Index matches the report's access pattern: filter by completed_at
-- range, group by machine. Partial index keeps it small (only
-- completed rows; in-progress rows don't have this column set).
CREATE INDEX IF NOT EXISTS carving_items_completed_on_machine_idx
  ON public.carving_items (completed_on_cnc_machine_id, completed_at DESC)
  WHERE completed_at IS NOT NULL
    AND completed_on_cnc_machine_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
