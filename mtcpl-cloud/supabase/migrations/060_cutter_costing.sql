-- ──────────────────────────────────────────────────────────────────
-- Migration 060: Cutter Costing — expenses + book-value config
-- ──────────────────────────────────────────────────────────────────
-- Daksh wants a cost-per-CFT report for cutting, parallel to the
-- existing CNC report (cnc-monthly-report.ts → /carving/reports).
-- The cutting side is simpler — no per-machine breakdown, no
-- vendor split. One pool of monthly operational expenses
-- (electricity / manpower / repair_maintenance / other) plus a
-- one-shot book value for all cutter machines combined; monthly
-- depreciation is derived as book_value / (useful_life_years*12).
--
-- The math:
--   monthly_cost = sum(cutter_expenses for that month)
--                + book_value / (life_years * 12)
--   cost_per_cft = total_cost_for_period / sum(cft cut in period)
-- where "cft cut in period" comes from cut_session_blocks joined
-- to slab_requirements, filtered to status='done' and approved_at
-- in the period.
--
-- Two new tables:
--   • cutter_expenses     — monthly opex by category
--   • cutter_book_values  — depreciation source (singleton-ish)
--
-- Same expense-categories pattern as cnc_vendor_expenses (mig 054)
-- minus the vendor_id (cutters are in-house, aggregate-only).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Operational expenses (electricity / manpower / repair / other) ─
CREATE TABLE IF NOT EXISTS public.cutter_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year         INT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Category list deliberately matches Daksh's spec. CNC uses
  -- different labels (tools/labor/office/maintenance) — keeping
  -- the cutter list distinct so the two reports stay independently
  -- editable.
  category     TEXT NOT NULL CHECK (
    category IN ('electricity', 'manpower', 'repair_maintenance', 'other')
  ),
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  note         TEXT NULL,
  entered_by   UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Soft-cancel for audit. cancel_reason recorded on flip; the row
  -- stays so /audit_logs has a target to point at.
  cancelled_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS cutter_expenses_period_live_idx
  ON public.cutter_expenses (year DESC, month DESC, category)
  WHERE cancelled_at IS NULL;

ALTER TABLE public.cutter_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY cutter_expenses_auth_read ON public.cutter_expenses
  FOR SELECT TO authenticated USING (true);

-- ── 2. Cutter machines book value (for depreciation) ──────────────
-- Multiple rows allowed — each replaces the previous. Latest non-
-- cancelled row with effective_from <= period_start applies to
-- that period. So the user can re-enter book value on (e.g.)
-- April 1 after a fresh asset purchase / writedown, without
-- losing the historical entries that drove prior periods'
-- depreciation.
CREATE TABLE IF NOT EXISTS public.cutter_book_values (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_value        NUMERIC(14, 2) NOT NULL CHECK (book_value >= 0),
  useful_life_years INT NOT NULL DEFAULT 10 CHECK (useful_life_years > 0 AND useful_life_years <= 50),
  effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  note              TEXT NULL,
  entered_by        UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS cutter_book_values_effective_idx
  ON public.cutter_book_values (effective_from DESC)
  WHERE cancelled_at IS NULL;

ALTER TABLE public.cutter_book_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY cutter_book_values_auth_read ON public.cutter_book_values
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
