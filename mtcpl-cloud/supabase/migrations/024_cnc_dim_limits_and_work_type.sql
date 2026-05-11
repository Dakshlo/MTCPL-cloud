-- ──────────────────────────────────────────────────────────────────
-- Migration 024: per-CNC bed limits + per-job work-type tag
--
-- Background — two related gaps in carving:
--
-- 1. Different CNCs have different workable areas. Today the system
--    has machine_type (single_head | multi_head_2 | lathe) but no
--    sense of "this slab is too big for this specific machine."
--    Operators can attempt to load oversized slabs; the only
--    feedback is the carving going wrong on the shop floor.
--
-- 2. The fleet has two real machine types: multi_head_2 and lathe.
--    Lathes only do cylindrical work; multi-heads only do flat-panel
--    work. The carving head has no way to tag a job upfront as
--    "needs a lathe", so the assign modal can't warn them when they
--    pick a vendor with no free lathe.
--
-- Schema additions:
--   cnc_machines.max_length_in / max_width_in / max_thickness_in
--     — per-machine physical envelope. NULL = no limit.
--   carving_items.requires_machine_type
--     — NULL  → flat-panel (default), must go on multi_head_2.
--     — 'lathe' → cylindrical, must go on a lathe.
--     — 'multi_head_2' or 'single_head' allowed for forward-compat
--       but not user-selectable today.
--
-- The CHECK constraint matches the existing cnc_machines machine_type
-- check (single_head | multi_head_2 | lathe). The single_head value
-- is a vestige from migration 021 — kept for forward-compat, but no
-- live machine uses it.
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Per-machine bed envelope ────────────────────────────────────
ALTER TABLE public.cnc_machines
  ADD COLUMN IF NOT EXISTS max_length_in NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS max_width_in NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS max_thickness_in NUMERIC(10,2);

-- ── 2. Per-job machine-type requirement ────────────────────────────
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS requires_machine_type TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carving_items_requires_machine_type_check'
  ) THEN
    ALTER TABLE public.carving_items
      DROP CONSTRAINT carving_items_requires_machine_type_check;
  END IF;
  ALTER TABLE public.carving_items
    ADD CONSTRAINT carving_items_requires_machine_type_check
    CHECK (
      requires_machine_type IS NULL
      OR requires_machine_type IN ('multi_head_2', 'lathe', 'single_head')
    );
END $$;

-- Partial index for the "what cylindrical jobs are queued?" widget.
CREATE INDEX IF NOT EXISTS carving_items_lathe_jobs_idx
  ON public.carving_items (vendor_id, assigned_at)
  WHERE requires_machine_type = 'lathe'
    AND status IN ('carving_assigned', 'carving_in_progress');

NOTIFY pgrst, 'reload schema';

COMMIT;
