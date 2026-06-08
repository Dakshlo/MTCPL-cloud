-- Migration 110 — Maintenance department: allow active_department='maintenance' (Daksh, June 2026)
--
-- Widens the profiles.active_department CHECK so users can switch into the
-- new Maintenance department. Same additive DROP-IF-EXISTS + re-ADD pattern
-- as mig 102 (which added 'register'). No data change.

BEGIN;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_department_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_department_check
    CHECK (active_department IN (
      'production', 'finance', 'inventory', 'invoicing', 'register', 'maintenance'
    ));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual): re-add the constraint without 'maintenance'
--   (only safe once no profile rows have active_department='maintenance').
