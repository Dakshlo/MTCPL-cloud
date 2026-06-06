-- Migration 096 — Outsource jobwork challans (printable GST bill)
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- When approved Outsource carving jobs are billed, we generate a challan
-- (JW-YYYY-N) listing each slab's CFT/SFT x rate = amount, plus optional
-- GST / RCM. Printed on the company letterhead. NOT wired into accounts
-- payments in v1 — it is a printable vendor jobwork bill.
--
-- GST math (computed in the app, stored frozen here):
--   amount_subtotal = sum(line amount)
--   gst_amount      = round(amount_subtotal * gst_pct / 100)
--   amount_total    = amount_subtotal + (is_rcm ? 0 : gst_amount)
--   (when is_rcm, GST is payable by the recipient under reverse charge
--    and is shown as a note, NOT added to the vendor-payable total.)
--
-- SAFETY: brand-new tables only; no enum changes; RLS read-all for
-- authenticated (mirrors invoicing mig 058). Idempotent. work_order_id is
-- a loose UUID (no FK) so this migration has no ordering dependency on
-- mig 095; the app keeps it valid.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.carving_challan_number_seq;

CREATE TABLE IF NOT EXISTS public.carving_challans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_number  TEXT UNIQUE,
  challan_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_id       UUID NOT NULL REFERENCES public.vendors(id),
  vendor_name     TEXT NOT NULL,
  work_order_id   UUID NULL,
  amount_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_pct         NUMERIC(5,2) NULL,
  gst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_rcm          BOOLEAN NOT NULL DEFAULT false,
  amount_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT NULL,
  cancelled_at    TIMESTAMPTZ NULL,
  cancel_reason   TEXT NULL,
  created_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.carving_challan_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id          UUID NOT NULL REFERENCES public.carving_challans(id) ON DELETE CASCADE,
  carving_item_id     UUID NULL REFERENCES public.carving_items(id) ON DELETE SET NULL,
  slab_requirement_id TEXT NULL REFERENCES public.slab_requirements(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit                TEXT NOT NULL CHECK (unit IN ('cft', 'sft')),
  rate                NUMERIC(12,2) NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  position            INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-number JW-YYYY-N (mirror invoicing assign_challan_number).
CREATE OR REPLACE FUNCTION public.assign_carving_challan_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.challan_number IS NULL THEN
    NEW.challan_number := 'JW-' || to_char(NOW(), 'YYYY') || '-' ||
      nextval('public.carving_challan_number_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_carving_challan_number ON public.carving_challans;
CREATE TRIGGER trg_carving_challan_number
  BEFORE INSERT ON public.carving_challans
  FOR EACH ROW EXECUTE FUNCTION public.assign_carving_challan_number();

CREATE INDEX IF NOT EXISTS carving_challans_vendor_idx
  ON public.carving_challans (vendor_id, challan_date DESC) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS carving_challan_items_challan_idx
  ON public.carving_challan_items (challan_id);
-- (Double-billing of a carving_item is guarded in the app, not a unique
--  index, so a cancelled challan can be regenerated.)

ALTER TABLE public.carving_challans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carving_challan_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='carving_challans'
                   AND policyname='carving_challans_read') THEN
    CREATE POLICY carving_challans_read ON public.carving_challans
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='carving_challan_items'
                   AND policyname='carving_challan_items_read') THEN
    CREATE POLICY carving_challan_items_read ON public.carving_challan_items
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.carving_challan_items;
--   DROP TABLE IF EXISTS public.carving_challans;
--   DROP FUNCTION IF EXISTS public.assign_carving_challan_number();
--   DROP SEQUENCE IF EXISTS public.carving_challan_number_seq;
