-- ──────────────────────────────────────────────────────────────────
-- Migration 023: received_at_vendor — close the assign → load gap
--
-- Today the carving lifecycle goes:
--   cut_done → carving_assigned → carving_in_progress (loaded) → ...
--
-- But in reality there's a physical step between "carving head clicks
-- Assign" and "vendor operator clicks Load": the slab has to be
-- physically moved to the vendor's shade. That gap is invisible —
-- no timestamp, no event row, so the team can't tell whether a slab
-- is "stuck in transit" or "sitting in the vendor's queue."
--
-- This migration adds the two columns that close that gap:
--   received_at_vendor_at  — when the slab physically arrived
--   received_at_vendor_by  — who acknowledged it (vendor operator
--                            from /vendor cockpit, OR carving head
--                            from the central view)
--
-- Auto-fill semantics: the load action also stamps these if NULL at
-- load time, so an operator who skips the explicit "Mark received"
-- click still gets a non-NULL value (we just attribute it to the
-- loader instead of the receiver).
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS received_at_vendor_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at_vendor_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Speeds up "queued at this vendor, not yet received" widgets on
-- the floor view, the vendor cockpit, and the active-tab cards.
CREATE INDEX IF NOT EXISTS carving_items_pending_receipt_idx
  ON public.carving_items (vendor_id, assigned_at)
  WHERE received_at_vendor_at IS NULL AND status = 'carving_assigned';

NOTIFY pgrst, 'reload schema';

COMMIT;
