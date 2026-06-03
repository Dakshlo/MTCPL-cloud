-- Migration 086 — yard-wise stock tracking for the warehouse.
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- Mig 083 created scaffolding_yards (YARD_A / YARD_B / YARD_C) + a
-- single yard_id on inventory_movements, but the stock model never
-- used it — there was no way to set or see stock yard-by-yard. This
-- migration makes yards first-class by MIRRORING the proven
-- site-transfer model (from_site_id / to_site_id) at the yard level:
--
--   • receive into a yard   → to_yard_id     (+qty to that yard)
--   • issue / write-off      → from_yard_id   (−qty from that yard)
--   • move between yards      → from_yard_id + to_yard_id (−A, +B)
--
-- Plant on-hand for a yard = Σ(to_yard = Y) − Σ(from_yard = Y), the
-- exact same shape as the per-site computation in stock.ts. Yards
-- apply to PLANT (warehouse) stock only; stock out at a project site
-- isn't in any yard.
--
-- It also assigns ALL current plant stock to Yard A (Daksh: "put them
-- all in yard 1") by back-filling the yard on existing plant
-- movements. Guarded with IS NULL so re-running is safe.
--
-- SAFETY: two additive nullable columns + a guarded back-fill that
-- only sets the YARD attribution on existing movements — no qty,
-- status, or void flag is touched, nothing is deleted, and the netted
-- balances are unchanged (they just now all live in Yard A). The old
-- single yard_id column from mig 083 is left in place, unused.

BEGIN;

-- ── 1. from_yard_id / to_yard_id on inventory_movements ─────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS from_yard_id UUID NULL
    REFERENCES public.scaffolding_yards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_yard_id   UUID NULL
    REFERENCES public.scaffolding_yards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_from_yard_idx
  ON public.inventory_movements (from_yard_id)
  WHERE from_yard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_to_yard_idx
  ON public.inventory_movements (to_yard_id)
  WHERE to_yard_id IS NOT NULL;

-- ── 2. Put all CURRENT plant stock in Yard A ────────────────────────
-- Receives into the plant get to_yard_id = Yard A; issues out of the
-- plant get from_yard_id = Yard A. The net (current on-hand) then all
-- attributes to Yard A. Project-site stock is left yard-less (it isn't
-- in the warehouse). Re-running is harmless (IS NULL guard).
DO $$
DECLARE
  yard_a UUID;
  plant  UUID;
BEGIN
  SELECT id INTO yard_a FROM public.scaffolding_yards WHERE code = 'YARD_A' LIMIT 1;
  SELECT id INTO plant  FROM public.sites WHERE is_plant = TRUE LIMIT 1;

  IF yard_a IS NOT NULL AND plant IS NOT NULL THEN
    UPDATE public.inventory_movements
       SET to_yard_id = yard_a
     WHERE is_voided = FALSE
       AND to_site_id = plant
       AND to_yard_id IS NULL;

    UPDATE public.inventory_movements
       SET from_yard_id = yard_a
     WHERE is_voided = FALSE
       AND from_site_id = plant
       AND from_yard_id IS NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
