-- 194: Employees dept — daily wage for by-attendance staff (Daksh, Jul 2026).
--
-- A "by attendance" employee is now paid a DAILY rate × days present, instead
-- of a monthly salary prorated by days-in-month. Fixed employees keep
-- monthly_salary. daily_salary is additive + nullable; earnedSalary() falls
-- back to the old monthly ÷ days-in-month proration when daily_salary is unset,
-- so existing by-attendance employees keep working until re-saved with a rate.

alter table public.salary_employees add column if not exists daily_salary numeric(14,2);

notify pgrst, 'reload schema';
