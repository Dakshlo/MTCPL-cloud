-- ──────────────────────────────────────────────────────────────────
-- Migration 043: Vendor-bill-number normalisation
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Mig 039 made (bill_vendor_id, vendor_bill_no, financial_year) a
-- unique constraint to stop duplicate bill entries. The constraint
-- compares the literal text of vendor_bill_no — so "1", "01",
-- "001", and "00001" land as four DIFFERENT keys. A vendor's
-- invoice numbers are routinely written with leading zeros
-- ("INV-001" / "INV-01" / "INV-1"), and an employee re-typing the
-- same paper bill without the same zero-padding would slip past
-- the duplicate check.
--
-- Daksh confirmed the behaviour he wants: 1 ≡ 01 ≡ 001 ≡ 00001 for
-- the same vendor and FY.
--
-- Fix
-- ───
-- Add a generated column vendor_bill_no_normalized that holds the
-- canonical form of the bill number:
--   • upper-cased
--   • trimmed
--   • leading zeros stripped from each numeric segment, where a
--     "segment" starts at a word boundary (the regex `\m` anchor)
--
-- Examples (after normalisation):
--   "1"             → "1"
--   "01"            → "1"
--   "001"           → "1"
--   "00001"         → "1"
--   "inv-001"       → "INV-1"
--   "INV-01"        → "INV-1"
--   "Bill/2026/001" → "BILL/2026/1"
--   "MK-001-005"    → "MK-1-5"
--   "10"            → "10"       (no leading zero to strip)
--   "100"           → "100"      (no leading zero to strip)
--   "INV01-001"     → "INV01-1"  (the "01" inside INV01 is NOT at a
--                                  word boundary, so it stays)
--   "0"             → "0"        (no trailing digit, regex no-op)
--
-- The unique index from mig 039 (bills_vendor_billno_fy_unique)
-- gets dropped and re-created against the normalised column. Now
-- the dedupe check matches what the human means.
--
-- If a fresh `CREATE UNIQUE INDEX` fails, it means existing rows
-- already collide after normalisation. The post-migration block
-- below has the diagnostic query you can paste to find the bad
-- rows; one of them will need to be cancelled (status →
-- 'cancelled') before the index can be created.
--
-- The regex uses Postgres' Advanced Regular Expression flavor —
-- `\m` is a left-word-boundary anchor and `(?=\d)` is a lookahead.
-- Both supported since PG 8.x.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS vendor_bill_no_normalized TEXT
    GENERATED ALWAYS AS (
      regexp_replace(upper(trim(vendor_bill_no)), '\m0+(?=\d)', '', 'g')
    ) STORED;

DROP INDEX IF EXISTS public.bills_vendor_billno_fy_unique;
CREATE UNIQUE INDEX bills_vendor_billno_fy_unique
  ON public.bills (bill_vendor_id, vendor_bill_no_normalized, financial_year);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Diagnostic: if CREATE UNIQUE INDEX fails with a duplicate-key
-- error, paste this to find the collision:
--
--   SELECT
--     bill_vendor_id,
--     vendor_bill_no_normalized,
--     financial_year,
--     array_agg(token ORDER BY submitted_at) AS conflicting_tokens,
--     count(*) AS n
--   FROM public.bills
--   WHERE status <> 'cancelled'
--   GROUP BY bill_vendor_id, vendor_bill_no_normalized, financial_year
--   HAVING count(*) > 1;
--
-- Cancel the offending bill via the UI (or set status='cancelled'
-- on the older row) and re-run the migration.
-- ──────────────────────────────────────────────────────────────────
