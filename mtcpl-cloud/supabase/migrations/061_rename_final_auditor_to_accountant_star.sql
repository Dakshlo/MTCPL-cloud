-- ──────────────────────────────────────────────────────────────────
-- Migration 061: rename final_auditor → accountant_star on app_role
-- ──────────────────────────────────────────────────────────────────
-- Mig 058 made the UI render `final_auditor` as "ACCOUNTANT ★" and
-- left the DB enum value unchanged (display-only change). Daksh
-- now wants the DB name to match the UI, so `profiles.role` shows
-- the same value an admin sees on screen.
--
-- ALTER TYPE ... RENAME VALUE is atomic (Postgres 10+) — Govind's
-- profiles row updates instantly, every RLS policy + view that
-- referenced the enum keeps working under the new name. No data
-- migration needed.
--
-- Code sweep happens in the same commit (every `'final_auditor'`
-- string literal across the Next.js app becomes `'accountant_star'`).
-- This migration + the code rename land together so there's no
-- moment when one half is on the old name and the other on the new.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TYPE public.app_role RENAME VALUE 'final_auditor' TO 'accountant_star';

NOTIFY pgrst, 'reload schema';

COMMIT;
