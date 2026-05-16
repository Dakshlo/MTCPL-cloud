-- ──────────────────────────────────────────────────────────────────
-- Migration 054: CNC operational expenses + machine depreciation
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh's dad wants cost-per-CFT / cost-per-SFT analysis on the
-- carving monthly report. Today the report only shows production
-- volume; cost data lives in scattered paper receipts.
--
-- Two cost components feed the same report:
--
-- 1. OPERATIONAL EXPENSES (manual entry).
--    A new dedicated role `cnc_expense_entry` enters these via a
--    single-page portal at /carving/expenses. The role has no other
--    surface in the app. Categories fixed at: tools, electricity,
--    labor, office, maintenance, other.
--
-- 2. MACHINE DEPRECIATION (auto-calculated).
--    Each CNC machine has a book value. The system applies an
--    annual WDV (Written Down Value) depreciation rate — default
--    15% per year (Income Tax Act §32 plant + machinery).
--    Two entry paths:
--      • For legacy machines: enter current_book_value +
--        book_value_as_of (the snapshot date).
--      • For new purchases: enter purchase_price + purchase_date.
--    WDV formula: current_value = base × (1 - rate)^years_elapsed,
--    floored at salvage_value. Monthly share = current_value × rate
--    / 12.
--
-- Phase 2 (cutters) is planned but NOT in this migration. Schema
-- designed so adding `cutter_expense_entry` + `cutter_vendor_expenses`
-- later is a copy-paste.
-- ──────────────────────────────────────────────────────────────────

-- ALTER TYPE … ADD VALUE has to live OUTSIDE BEGIN/COMMIT.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cnc_expense_entry';

BEGIN;

-- ── Operational expenses table ─────────────────────────────────────
-- One row per expense line. (vendor_id, year, month) is the natural
-- analytics group — the carving report builder sums all non-
-- cancelled rows in that group. Soft-cancel (cancelled_at) instead
-- of hard-delete preserves the audit trail.
CREATE TABLE IF NOT EXISTS public.cnc_vendor_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL
                  REFERENCES public.vendors(id) ON DELETE CASCADE,
  year          SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  category      TEXT NOT NULL CHECK (category IN (
                  'tools', 'electricity', 'labor', 'office',
                  'maintenance', 'other'
                )),
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

-- Reporting-side index: pull all (vendor, year, month) rows for the
-- carving report builder in one B-tree scan.
CREATE INDEX IF NOT EXISTS cnc_vendor_expenses_vendor_period_idx
  ON public.cnc_vendor_expenses (vendor_id, year, month)
  WHERE cancelled_at IS NULL;

-- Recent-entries-by-user view (for the audit table on the entry page).
CREATE INDEX IF NOT EXISTS cnc_vendor_expenses_recent_idx
  ON public.cnc_vendor_expenses (entered_at DESC)
  WHERE cancelled_at IS NULL;

-- Defense-in-depth: enable RLS with no policies. All app access
-- goes through createAdminSupabaseClient (service_role) which
-- bypasses RLS — so server actions + the report builder keep
-- working. Anon / authenticated keys can't touch this table.
-- Same pattern as vendor_private_notes (mig 050) and others.
ALTER TABLE public.cnc_vendor_expenses ENABLE ROW LEVEL SECURITY;

-- ── Machine depreciation columns on cnc_machines ──────────────────
-- Five new columns + one sensible default.
ALTER TABLE public.cnc_machines
  ADD COLUMN IF NOT EXISTS purchase_price        NUMERIC(14, 2) NULL
                            CHECK (purchase_price IS NULL OR purchase_price >= 0),
  ADD COLUMN IF NOT EXISTS purchase_date         DATE NULL,
  ADD COLUMN IF NOT EXISTS current_book_value    NUMERIC(14, 2) NULL
                            CHECK (current_book_value IS NULL OR current_book_value >= 0),
  ADD COLUMN IF NOT EXISTS book_value_as_of      DATE NULL,
  ADD COLUMN IF NOT EXISTS depreciation_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 15.00
                            CHECK (depreciation_rate_pct >= 0 AND depreciation_rate_pct <= 100),
  ADD COLUMN IF NOT EXISTS salvage_value         NUMERIC(14, 2) NOT NULL DEFAULT 0
                            CHECK (salvage_value >= 0);

COMMENT ON COLUMN public.cnc_machines.purchase_price IS
  'Original purchase price (Rs.). Used with purchase_date to depreciate forward via WDV.';
COMMENT ON COLUMN public.cnc_machines.current_book_value IS
  'Snapshot book value (Rs.) for legacy machines without a recorded purchase. Used with book_value_as_of as the depreciation base.';
COMMENT ON COLUMN public.cnc_machines.depreciation_rate_pct IS
  'Annual WDV depreciation rate (percent). Default 15 per Income Tax Act Sec.32 for general plant + machinery.';
COMMENT ON COLUMN public.cnc_machines.salvage_value IS
  'Floor (Rs.) below which the book value never depreciates. 0 means depreciable to zero.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Diagnostic queries (manual) ─────────────────────────────────
-- Expenses entered for a given month:
--   SELECT v.name AS vendor, e.category, e.amount, e.note,
--          p.full_name AS entered_by, e.entered_at AT TIME ZONE 'Asia/Kolkata' AS time_ist
--     FROM public.cnc_vendor_expenses e
--     JOIN public.vendors v ON v.id = e.vendor_id
--     LEFT JOIN public.profiles p ON p.id = e.entered_by
--    WHERE e.year = 2026 AND e.month = 5 AND e.cancelled_at IS NULL
--    ORDER BY v.name, e.entered_at;
--
-- Machine depreciation preview (run in any month):
--   SELECT m.machine_code,
--          v.name AS vendor,
--          COALESCE(m.purchase_price, m.current_book_value) AS base_value,
--          COALESCE(m.purchase_date, m.book_value_as_of) AS base_date,
--          m.depreciation_rate_pct AS rate_pct,
--          m.salvage_value
--     FROM public.cnc_machines m
--     JOIN public.vendors v ON v.id = m.vendor_id
--    WHERE COALESCE(m.purchase_price, m.current_book_value) IS NOT NULL
--    ORDER BY v.name, m.machine_code;
