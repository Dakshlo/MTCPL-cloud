-- Migration 067 — Ensure 'vendor' exists in the app_role enum.
--
-- Daksh, May 2026 — saving a profile with role = 'vendor' via the
-- Settings → Users picker errored out with
--   "invalid input value for enum app_role: 'vendor'"
-- on this environment. The codebase has assumed `vendor` was a
-- valid enum member since the earliest days (it drives the CNC
-- operator cockpit at /vendor), but no migration in this repo ever
-- explicitly added it — the value was seeded in the original
-- Supabase Studio schema setup that predates the migrations folder.
-- Newer environments that bootstrap from migrations alone never
-- pick it up.
--
-- This migration runs `ADD VALUE IF NOT EXISTS` so it's a no-op
-- on environments that already have the value, and seeds it on
-- the ones that don't. Postgres requires ALTER TYPE ADD VALUE to
-- run outside a transaction block, so this file is intentionally
-- bare (no BEGIN/COMMIT).
--
-- The same ADD VALUE pattern is already used by migrations 025
-- (slab_transfer), 028 (biller/accountant), 037 (crosscheck),
-- 041 (storekeeper), 053 (final_auditor), 054 (cnc_expense_entry).

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendor';

NOTIFY pgrst, 'reload schema';
