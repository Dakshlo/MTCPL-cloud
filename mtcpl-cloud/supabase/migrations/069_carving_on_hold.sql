-- Migration 069 — Carving "on hold" workflow.
--
-- Daksh, May 2026 — vendors need to pause a slab mid-carve:
--   1. Two-sided carving: carve side 1, hold, free the machine for
--      another slab, later flip + reload to carve side 2.
--   2. Power / scheduling: realised they can't keep all CNCs running
--      after loading. Park the slab without losing the load history.
--
-- The slab keeps `vendor_id` (it stays with this vendor) but
-- detaches from the machine — same shape as carving_assigned, but
-- distinguishable so the cockpit can surface "what's parked here"
-- separately from "what's queued to start". Re-load goes back to
-- the held_from_machine by default, with a picker for any compatible
-- alternative CNC.
--
-- carving_items.status is a TEXT column (no CHECK constraint), so
-- we don't need an ALTER TYPE — just start writing the new value.

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS held_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_reason TEXT NULL,
  -- Remember the machine the vendor unloaded from so the reload
  -- modal can default to "back to MA-X" with one tap. Nullable
  -- because legacy holds (if backfilled) might not know.
  ADD COLUMN IF NOT EXISTS held_from_machine_id UUID NULL
    REFERENCES public.cnc_machines(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.carving_items.held_at IS
  'When the slab was put on hold (status=carving_on_hold). Drives the "held for Xh Ym" chip in the cockpit so the operator sees how long a slab has been parked.';
COMMENT ON COLUMN public.carving_items.held_by IS
  'Who put it on hold. Usually the vendor; carving_head / owner / developer can also hold on the vendor''s behalf.';
COMMENT ON COLUMN public.carving_items.held_reason IS
  'Optional free-text note. Common values used by the UI radios: "two_side_flip", "no_power", "tool_change", "other".';
COMMENT ON COLUMN public.carving_items.held_from_machine_id IS
  'The CNC the slab was on right before it was held. Reload modal defaults to this machine so flipping side-1 → side-2 is a single tap.';

-- Partial index: held slabs per vendor. Used by the "On Hold"
-- launcher count in the cockpit header. Tiny — usually <10 rows
-- per vendor.
CREATE INDEX IF NOT EXISTS carving_items_on_hold_idx
  ON public.carving_items (vendor_id, held_at DESC)
  WHERE status = 'carving_on_hold';

NOTIFY pgrst, 'reload schema';
COMMIT;
