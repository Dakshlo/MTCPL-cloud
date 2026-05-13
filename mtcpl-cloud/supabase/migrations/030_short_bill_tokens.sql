-- ──────────────────────────────────────────────────────────────────
-- Migration 030: Shorter bill tokens
--
-- Why
-- ───
-- TOK-YYYY-NNNNN (14 chars) dominates the bill list and the bill
-- audit cards visually. The accountant scans these all day — a
-- shorter form is friendlier without losing the year (which they
-- need for accounting period context).
--
-- New format: T-YYYY-N
--   • T- prefix (1 char) keeps a hint that it's a token
--   • year (4 chars) preserved for accounting clarity
--   • sequence (1–N chars) with NO leading zeros
-- Examples:
--   TOK-2026-00001 → T-2026-1
--   TOK-2026-00042 → T-2026-42
--   TOK-2026-12345 → T-2026-12345
-- 14 chars → 8 chars (≈40% shorter for the typical case).
--
-- Approach
-- ────────
--   1. Rewrite the assign_bill_token trigger to emit the new format.
--   2. UPDATE existing bills to the new format via regex_replace.
--      Old TOK- prefix → T-, leading zeros stripped from the sequence.
--   3. bill_token_seq keeps its current value — new bills continue
--      from wherever it's at, so there's no chance of a fresh insert
--      colliding with a renamed legacy row.
--
-- Idempotent: the UPDATE only matches `TOK-%` rows. Re-running won't
-- re-match the already-shortened tokens.
--
-- No data is destroyed — `tokens` are display-only references; the
-- bill rows themselves are untouched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- Rewrite the trigger function to emit the new shorter format.
-- CREATE OR REPLACE FUNCTION keeps the trigger binding intact.
CREATE OR REPLACE FUNCTION public.assign_bill_token()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  next_n BIGINT;
  yr     TEXT;
BEGIN
  IF NEW.token IS NOT NULL AND NEW.token <> '' THEN
    RETURN NEW;
  END IF;
  yr := to_char(COALESCE(NEW.bill_date, CURRENT_DATE), 'YYYY');
  next_n := nextval('public.bill_token_seq');
  NEW.token := 'T-' || yr || '-' || next_n::text;
  RETURN NEW;
END;
$$;

-- Rename existing tokens. Captures the year (4 digits) and the
-- non-zero sequence digits, drops the TOK- prefix + leading zeros.
UPDATE public.bills
   SET token = regexp_replace(token, '^TOK-(\d{4})-0*(\d+)$', 'T-\1-\2')
 WHERE token LIKE 'TOK-%';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste after running):
--
--   SELECT token, bill_date, amount_total
--     FROM public.bills
--    ORDER BY submitted_at DESC
--    LIMIT 10;
--
-- All tokens should now read T-YYYY-N. Inserting a new bill should
-- produce the next sequence in the new format.
-- ──────────────────────────────────────────────────────────────────
