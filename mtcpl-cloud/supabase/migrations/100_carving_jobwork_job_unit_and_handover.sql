-- ──────────────────────────────────────────────────────────────────
-- Migration 100: Work/Job flat-per-slab pricing + work-order handover
--
-- Two outsource work-order changes (Daksh, June 2026):
--
-- 1. A third jobwork unit 'job' alongside 'cft'/'sft'. 'job' = a FLAT
--    rupee amount PER SLAB (e.g. ₹40,000 each), independent of volume.
--    Widen every jobwork_unit / unit CHECK so 'job' is accepted and so a
--    single challan can later mix cft + sft + job priced slabs.
--
-- 2. Handover step: after the owner approves a work order (+ price), the
--    office prints a signed work-order document and hands it to the
--    vendor; only THEN can slabs be sent. handed_over_at/by record that.
--
-- Additive + safe: CHECK widening is a superset (no existing row becomes
-- invalid); columns are ADD IF NOT EXISTS. No data touched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1a. carving_items.jobwork_unit (explicit name from mig 094)
ALTER TABLE public.carving_items DROP CONSTRAINT IF EXISTS carving_items_jobwork_unit_chk;
ALTER TABLE public.carving_items
  ADD CONSTRAINT carving_items_jobwork_unit_chk
  CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft', 'sft', 'job'));

-- 1b. carving_work_orders.jobwork_unit (inline check, default name)
ALTER TABLE public.carving_work_orders DROP CONSTRAINT IF EXISTS carving_work_orders_jobwork_unit_check;
ALTER TABLE public.carving_work_orders
  ADD CONSTRAINT carving_work_orders_jobwork_unit_check
  CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft', 'sft', 'job'));

-- 1c. carving_work_order_items.jobwork_unit (override, inline check)
ALTER TABLE public.carving_work_order_items DROP CONSTRAINT IF EXISTS carving_work_order_items_jobwork_unit_check;
ALTER TABLE public.carving_work_order_items
  ADD CONSTRAINT carving_work_order_items_jobwork_unit_check
  CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft', 'sft', 'job'));

-- 1d. carving_challan_items.unit (so challans can bill job-priced slabs)
ALTER TABLE public.carving_challan_items DROP CONSTRAINT IF EXISTS carving_challan_items_unit_check;
ALTER TABLE public.carving_challan_items
  ADD CONSTRAINT carving_challan_items_unit_check
  CHECK (unit IN ('cft', 'sft', 'job'));

-- 2. Handover trail.
ALTER TABLE public.carving_work_orders
  ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handed_over_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
