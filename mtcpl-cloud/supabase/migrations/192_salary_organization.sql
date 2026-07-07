-- 192: Salary/PF — organization (site) on employees (Daksh, Jul 2026).
--
-- Employees belong to a site / organization (e.g. "Main Office", "Ram Mandir
-- Site", "XYZ"); designations sit UNDER an organization, giving a two-level
-- Organization → Designation → Employee grouping shown on screen and in the PF
-- register export. Additive + nullable.

alter table public.salary_employees add column if not exists organization text;

notify pgrst, 'reload schema';
