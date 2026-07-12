-- 196: Employees dept — TDS deduction + ESI default 0.75% (Daksh, Jul 2026).
--
-- TDS: a third statutory deduction alongside PF + ESI, per-employee toggle
-- (default OFF) + employee-share percent (default 10% of the earned gross,
-- no ceiling). Feeds the Register of Wages template + the net calculation.
-- ESI default corrected to the statutory 0.75% employee share (was 1%);
-- existing employees keep whatever they were set to — only the DEFAULT for new
-- ones changes.

alter table public.salary_employees add column if not exists tds_enabled boolean not null default false;
alter table public.salary_employees add column if not exists tds_percent numeric(5,2) not null default 10;
alter table public.salary_payments add column if not exists tds_amount numeric(14,2) not null default 0;

alter table public.salary_employees alter column esi_percent set default 0.75;

notify pgrst, 'reload schema';
