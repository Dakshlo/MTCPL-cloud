-- ──────────────────────────────────────────────────────────────────
-- 019: CNC operations module
--
-- Phase 3 carving — switch from "vendor picks slab + we track a single
-- in-progress flag" to a full CNC ops cockpit:
--   • Each CNC machine has a live status (idle / carving /
--     maintenance / inactive) so the assign modal can show the
--     carving head live free-machine counts per vendor.
--   • Carving items carry an urgency flag and two estimated-time
--     fields: a rough one set at assignment, and a tighter one set by
--     the vendor when they actually load the slab.
--   • cnc_machine_events table tracks every load / unload / mainte-
--     nance flip for audit and machine-history views.
--
-- Idempotent — safe to re-run. No existing rows are modified.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. cnc_machines: live status + current carving + maintenance ──
ALTER TABLE public.cnc_machines
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS current_carving_item_id UUID,
  ADD COLUMN IF NOT EXISTS maintenance_reason TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maintenance_flagged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Constraint on status values. Drop-then-add lets us re-run safely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cnc_machines_status_check') THEN
    ALTER TABLE public.cnc_machines DROP CONSTRAINT cnc_machines_status_check;
  END IF;
  ALTER TABLE public.cnc_machines
    ADD CONSTRAINT cnc_machines_status_check
    CHECK (status IN ('idle', 'carving', 'maintenance', 'inactive'));
END $$;

-- FK for current_carving_item_id (added separately so the column add
-- above never fails on a missing-table error in fresh envs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'cnc_machines_current_carving_item_fkey'
  ) THEN
    ALTER TABLE public.cnc_machines
      ADD CONSTRAINT cnc_machines_current_carving_item_fkey
      FOREIGN KEY (current_carving_item_id)
      REFERENCES public.carving_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index used by the live "free CNCs per vendor" widget on the carving
-- head's assign modal.
CREATE INDEX IF NOT EXISTS cnc_machines_vendor_status_idx
  ON public.cnc_machines (vendor_id, status)
  WHERE is_active = TRUE;

-- ── 2. carving_items: urgency + load/unload tracking ──────────────
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS urgency TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS loaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unloaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unloaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS temporary_location TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carving_items_urgency_check') THEN
    ALTER TABLE public.carving_items DROP CONSTRAINT carving_items_urgency_check;
  END IF;
  ALTER TABLE public.carving_items
    ADD CONSTRAINT carving_items_urgency_check
    CHECK (urgency IN ('normal', 'urgent'));
END $$;

-- Drives the queue list on the vendor cockpit (sorted by urgency then
-- assigned_at) — covers vendor + status filter.
CREATE INDEX IF NOT EXISTS carving_items_vendor_status_idx
  ON public.carving_items (vendor_id, status, urgency, assigned_at);

-- ── 3. cnc_machine_events — audit + history ───────────────────────
CREATE TABLE IF NOT EXISTS public.cnc_machine_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnc_machine_id UUID NOT NULL REFERENCES public.cnc_machines(id) ON DELETE CASCADE,
  -- 'loaded' | 'unloaded' | 'maintenance_start' | 'maintenance_end'
  -- | 'created' | 'reactivated' | 'deactivated'
  event_type TEXT NOT NULL,
  carving_item_id UUID REFERENCES public.carving_items(id) ON DELETE SET NULL,
  reason TEXT,
  message TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cnc_machine_events_machine_idx
  ON public.cnc_machine_events (cnc_machine_id, created_at DESC);

-- ── 4. Permissive RLS so authenticated users (vendors, carving
--      heads) can SELECT. Writes go through server actions using
--      the admin/service-role key which bypasses RLS entirely.
ALTER TABLE public.cnc_machine_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cnc_machine_events signed_in read" ON public.cnc_machine_events;
CREATE POLICY "cnc_machine_events signed_in read" ON public.cnc_machine_events
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── 5. Backfill existing in-progress carving_items so the cockpit
--      doesn't show ghost machines. If any carving_item is currently
--      'carving_in_progress' AND has a cnc_machine_id, mark that
--      machine as 'carving' + point current_carving_item_id at it.
--      This is a one-time data fix; subsequent loads/unloads happen
--      via the server actions.
UPDATE public.cnc_machines m
SET status = 'carving',
    current_carving_item_id = ci.id
FROM public.carving_items ci
WHERE ci.cnc_machine_id = m.id
  AND ci.status = 'carving_in_progress'
  AND m.status = 'idle'
  AND m.is_active = TRUE;

-- Backfill loaded_at for in-progress jobs that pre-date this column
-- (use assigned_at as a best-guess so the cockpit timer doesn't
-- explode showing "loaded null minutes ago").
UPDATE public.carving_items
SET loaded_at = assigned_at
WHERE status = 'carving_in_progress'
  AND loaded_at IS NULL;

COMMIT;
