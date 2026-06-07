-- Migration 102 — Activity Register becomes its own department (Daksh, June 2026)
--
-- Mig 101 shipped the Activity Register as a page inside the Production
-- room. Daksh wants it to be its OWN department — a 5th switcher tile
-- alongside Production / Finance / Invoicing / Inventory. The department a
-- user is currently in is stored in profiles.active_department, which has
-- a CHECK constraint (added in mig 036, last widened in mig 038 to add
-- 'invoicing'). To let the new tile actually persist, widen that CHECK to
-- also allow 'register'.
--
-- SAFETY: this ONLY widens a CHECK constraint on profiles — it relaxes
-- which values the column may hold going forward. It does NOT read,
-- change, move, or delete a single row of data. Every existing profile
-- keeps its current active_department (all still valid). This is the exact
-- same safe pattern mig 038 used to add 'invoicing'. Idempotent.

BEGIN;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_department_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_department_check
    CHECK (active_department IN ('production', 'finance', 'inventory', 'invoicing', 'register'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual) — only safe if no profile has active_department='register':
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_active_department_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_department_check
--     CHECK (active_department IN ('production', 'finance', 'inventory', 'invoicing'));
