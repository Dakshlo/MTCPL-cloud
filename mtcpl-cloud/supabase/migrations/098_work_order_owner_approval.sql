-- ──────────────────────────────────────────────────────────────────
-- Migration 098: Work-order owner price approval
--
-- Outsource is now Work-Order-only (the Unassigned direct-assign path is
-- gone). A new work order carries a MANDATORY price and starts in
-- 'pending_approval'; the owner approves it (optionally editing the
-- price) or rejects it. Only an approved WO can have slabs sent to the
-- vendor. (Daksh June 2026.)
--
--   status flow: pending_approval → open (approved) → in_progress
--                → completed / cancelled, or → rejected
--
-- Existing work orders already at 'open'/'in_progress' are grandfathered
-- (treated as already-approved) — the new CHECK is a superset so no
-- existing row is invalidated.
--
-- Additive + safe: widens the status CHECK + adds approval columns.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- Widen the status CHECK to include the two new states.
ALTER TABLE public.carving_work_orders
  DROP CONSTRAINT IF EXISTS carving_work_orders_status_check;
ALTER TABLE public.carving_work_orders
  ADD CONSTRAINT carving_work_orders_status_check
  CHECK (status IN ('pending_approval','open','in_progress','completed','cancelled','rejected'));

-- Owner approval / rejection trail.
ALTER TABLE public.carving_work_orders
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

NOTIFY pgrst, 'reload schema';
COMMIT;
