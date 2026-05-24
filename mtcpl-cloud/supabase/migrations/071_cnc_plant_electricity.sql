-- ──────────────────────────────────────────────────────────────────
-- Migration 071: Plant-wide CNC electricity (one entry per month)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh: "in cnc costing we give expense vendor wise keep it that way
-- but just electricity will be global for all — we will enter monthly
-- electricity bill for total units."
--
-- Today every cost line lives in `cnc_vendor_expenses`, keyed by
-- vendor_id. Electricity was one of the six categories. In practice
-- the electricity meter is at the plant gate, not per-vendor — the
-- per-vendor split was made up. This migration captures the real
-- shape: one monthly electricity bill, totals + units, plant-wide.
--
-- Approach
-- ────────
-- • New table `cnc_plant_electricity` — one row per (year, month),
--   carries amount + units_kwh. Soft-cancel for audit.
-- • UNIQUE constraint on active (year, month) so the entry form
--   can't insert duplicates.
-- • Existing electricity rows in `cnc_vendor_expenses` are left in
--   place (historical). The entry UI drops "electricity" from the
--   per-vendor category dropdown going forward; reports continue
--   to read the old rows for past months until back-filled.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.cnc_plant_electricity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year          SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Units consumed (kWh). Optional — owner may know only the bill
  -- amount for a given month. NULL is fine.
  units_kwh     NUMERIC(12, 2) NULL CHECK (units_kwh IS NULL OR units_kwh >= 0),
  amount        NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  note          TEXT NULL CHECK (length(coalesce(note,'')) <= 500),
  entered_by    UUID NOT NULL
                  REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID NULL
                  REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at  TIMESTAMPTZ NULL,
  cancelled_by  UUID NULL
                  REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason TEXT NULL
);

-- One active electricity entry per month — re-entries soft-cancel
-- the previous and insert a new row, so the unique index covers
-- only non-cancelled rows. Same pattern as bills_unique_no_idx.
CREATE UNIQUE INDEX IF NOT EXISTS cnc_plant_electricity_unique_month_idx
  ON public.cnc_plant_electricity (year, month)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS cnc_plant_electricity_recent_idx
  ON public.cnc_plant_electricity (entered_at DESC)
  WHERE cancelled_at IS NULL;

-- Same RLS posture as cnc_vendor_expenses (mig 054) — RLS enabled
-- with no policies; all access goes through service_role.
ALTER TABLE public.cnc_plant_electricity ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Diagnostic:
--   SELECT year, month, units_kwh, amount, note
--     FROM public.cnc_plant_electricity
--    WHERE cancelled_at IS NULL
--    ORDER BY year DESC, month DESC LIMIT 12;
