-- ──────────────────────────────────────────────────────────────────────
-- Migration 039 — Bill duplicate prevention scoped by financial year
-- ──────────────────────────────────────────────────────────────────────
-- The original uniqueness rule (migration 028) was:
--   UNIQUE (bill_vendor_id, vendor_bill_no)
-- Which blocked a vendor from ever using the same bill number twice —
-- but Indian vendors RESET their invoice numbering every financial
-- year. e.g. "Raju" sends bill #1 in May 2025 and bill #1 again in
-- April 2026 (his FY-26 #1). Both legitimate, neither a duplicate.
--
-- New rule: uniqueness is scoped to (vendor, bill_no, financial_year).
-- Same vendor + same bill number can be used once per FY, blocked
-- within the same FY.
--
-- Implementation:
--   1. Drop the old global-per-vendor unique constraint.
--   2. Add a GENERATED financial_year column derived from bill_date.
--      Indian FY runs April → March: month >= 4 keeps current year,
--      Jan/Feb/March belongs to the previous-year FY.
--   3. Add a UNIQUE INDEX on (bill_vendor_id, vendor_bill_no,
--      financial_year). PG raises SQLSTATE 23505 on conflict — the
--      existing submitBillAction handler catches that and surfaces a
--      friendly "duplicate bill" message.
--
-- Idempotent: drops / adds use IF EXISTS / IF NOT EXISTS.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Drop the old constraint. Name was set in migration 028 as
--    `bills_vendor_billno_unique`. Use IF EXISTS so re-running the
--    migration is safe even if it's already been dropped.
ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_vendor_billno_unique;

-- 2. Add the generated financial_year column.
--    Indian FY: April 1 → March 31. The integer stored is the year
--    the FY STARTS in (so FY 2025-26 → 2025).
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS financial_year INT GENERATED ALWAYS AS (
    CASE
      WHEN EXTRACT(MONTH FROM bill_date) >= 4
        THEN EXTRACT(YEAR FROM bill_date)::INT
      ELSE (EXTRACT(YEAR FROM bill_date) - 1)::INT
    END
  ) STORED;

-- 3. Unique index — same (vendor, bill_no) can repeat across FYs,
--    blocked within the same FY. Triggers SQLSTATE 23505 on conflict.
CREATE UNIQUE INDEX IF NOT EXISTS bills_vendor_billno_fy_unique
  ON public.bills (bill_vendor_id, vendor_bill_no, financial_year);

-- Reload PostgREST so the new column shows up in API responses.
NOTIFY pgrst, 'reload schema';

COMMIT;
