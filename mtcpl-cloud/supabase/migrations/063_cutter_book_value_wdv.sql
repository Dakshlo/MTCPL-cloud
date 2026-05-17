-- ──────────────────────────────────────────────────────────────────
-- Migration 063: cutter_book_values — depreciation rate + salvage
-- ──────────────────────────────────────────────────────────────────
-- Mig 060 set up cutter depreciation as flat straight-line — every
-- month the same number. Daksh wants the proper "declining balance"
-- (a.k.a. Written Down Value / WDV) method instead:
--
--   year 1:  dep = book × rate            → end value = book × (1-rate)
--   year 2:  dep = book × (1-rate) × rate → end value = book × (1-rate)^2
--   year 3:  dep = book × (1-rate)^2 × rate
--   ...
--
-- His example: book = ₹100, rate = 15%.
--   year 1 dep = ₹15      (monthly = 1.25)
--   year 2 dep = ₹12.75   (monthly = 1.06)
--   year 3 dep = ₹10.84   (monthly = 0.90)
--   ...
--
-- Each year is computed against the prior year's end value. Within
-- a year the monthly amount stays constant (matches Indian tax
-- practice). Drops at the year boundary.
--
-- Two new columns on cutter_book_values:
--   • depreciation_rate_pct — annual % (default 15, same as CNC default)
--   • salvage_value         — floor; current_value never drops below
--
-- useful_life_years stays in place (informational — businesses still
-- think in lifetime terms even when the math is rate-driven).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.cutter_book_values
  ADD COLUMN IF NOT EXISTS depreciation_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 15
    CHECK (depreciation_rate_pct >= 0 AND depreciation_rate_pct <= 100),
  ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(14, 2) NOT NULL DEFAULT 0
    CHECK (salvage_value >= 0);

NOTIFY pgrst, 'reload schema';

COMMIT;
