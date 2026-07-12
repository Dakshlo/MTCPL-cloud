-- ─────────────────────────────────────────────────────────────────────────
-- Migration 197 — Employees dept: per-employee "Minimum Rate of Wages".
--
-- The statutory Register of Wages (Form 11) has a "Min. Rate of Wages (A)"
-- column that we currently print as "—". Daksh: capture it per employee on the
-- add/edit form and print it in the register. Purely a reference figure — it
-- does NOT affect any earned-salary / PF / ESI / net calculation.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.salary_employees
  add column if not exists min_wage_rate numeric;

notify pgrst, 'reload schema';
