-- 195: New "Employee register" role (Daksh, Jul 2026).
--
-- A role dedicated to the Employees department (salary / PF / ESI / bank
-- sheet) — full access to that department and nothing else. The plain
-- ACCOUNTANT role also gains the Employees department (was ACCOUNTANT★ only);
-- that widening is code-side (allowedDepartmentsForRole + canUseSalary), no DB
-- change. profiles.active_department already allows 'salary' (mig 189).
--
-- profiles.role is the public.app_role ENUM — extend it (same pattern as
-- mig 037's crosscheck). ADD VALUE runs outside a txn block; it's a no-op if
-- the value already exists.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'employee_register';

notify pgrst, 'reload schema';
