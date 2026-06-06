-- Migration 095 — Outsource carving work orders (incl. pre-cut)
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- A work order lets us give an Outsource vendor a future-need order BEFORE
-- the slabs are cut (even before they reach the Plan Generator). A line may
-- reference an existing slab (any status) OR be pure free text (description +
-- planned size) until the real slab exists. This layer NEVER creates a
-- carving_item or changes slab_requirements.status — the cutting pipeline is
-- untouched. Only when a line's slab is genuinely cut_done and "Sent" does
-- the existing gated assign create the carving_item.
--
-- SAFETY: brand-new tables only; NO enum changes (line_status is a plain TEXT
-- CHECK, off the shared slab_status enum); RLS read-all for authenticated
-- (mirrors invoicing mig 058). Idempotent.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.work_order_number_seq;

CREATE TABLE IF NOT EXISTS public.carving_work_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number     TEXT UNIQUE,
  vendor_id     UUID NOT NULL REFERENCES public.vendors(id),
  vendor_name   TEXT NOT NULL,
  title         TEXT NULL,
  temple        TEXT NULL,
  jobwork_rate  NUMERIC(12,2) NULL,
  jobwork_unit  TEXT NULL CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft','sft')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','completed','cancelled')),
  notes         TEXT NULL,
  cancelled_at  TIMESTAMPTZ NULL,
  cancel_reason TEXT NULL,
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.carving_work_order_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id        UUID NOT NULL REFERENCES public.carving_work_orders(id) ON DELETE CASCADE,
  -- The slab this line is about. NULLABLE: a pure future-need line has no
  -- slab_requirements row yet. Set later (cut in-house or added external).
  slab_requirement_id  TEXT NULL REFERENCES public.slab_requirements(id) ON DELETE SET NULL,
  -- Set when the slab is actually sent to the vendor (the existing gated
  -- assign runs, a carving_items row is born, its id is stamped here).
  carving_item_id      UUID NULL REFERENCES public.carving_items(id) ON DELETE SET NULL,
  description          TEXT NULL,
  planned_length_ft    NUMERIC(10,2) NULL,
  planned_width_ft     NUMERIC(10,2) NULL,
  planned_thickness_ft NUMERIC(10,2) NULL,
  qty                  INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  jobwork_rate         NUMERIC(12,2) NULL,
  jobwork_unit         TEXT NULL CHECK (jobwork_unit IS NULL OR jobwork_unit IN ('cft','sft')),
  line_status          TEXT NOT NULL DEFAULT 'planned'
                         CHECK (line_status IN ('planned','sent','received','approved','cancelled')),
  position             INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live work-order line per slab (cancelled lines + NULL slabs excluded).
CREATE UNIQUE INDEX IF NOT EXISTS cwoi_one_live_line_per_slab
  ON public.carving_work_order_items (slab_requirement_id)
  WHERE slab_requirement_id IS NOT NULL AND line_status <> 'cancelled';
CREATE INDEX IF NOT EXISTS cwoi_work_order_idx
  ON public.carving_work_order_items (work_order_id);
CREATE INDEX IF NOT EXISTS cwo_vendor_idx
  ON public.carving_work_orders (vendor_id, created_at DESC) WHERE cancelled_at IS NULL;

-- Auto-number WO-YYYY-N (mirror invoicing assign_challan_number).
CREATE OR REPLACE FUNCTION public.assign_work_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.wo_number IS NULL THEN
    NEW.wo_number := 'WO-' || to_char(NOW(), 'YYYY') || '-' ||
      nextval('public.work_order_number_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_order_number ON public.carving_work_orders;
CREATE TRIGGER trg_work_order_number
  BEFORE INSERT ON public.carving_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_work_order_number();

ALTER TABLE public.carving_work_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carving_work_order_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='carving_work_orders'
                   AND policyname='carving_work_orders_read') THEN
    CREATE POLICY carving_work_orders_read ON public.carving_work_orders
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='carving_work_order_items'
                   AND policyname='carving_work_order_items_read') THEN
    CREATE POLICY carving_work_order_items_read ON public.carving_work_order_items
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.carving_work_order_items;
--   DROP TABLE IF EXISTS public.carving_work_orders;
--   DROP FUNCTION IF EXISTS public.assign_work_order_number();
--   DROP SEQUENCE IF EXISTS public.work_order_number_seq;
