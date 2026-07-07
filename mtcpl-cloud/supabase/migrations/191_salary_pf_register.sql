-- 191: Salary/PF v2 — PF register fields (Daksh, Jul 2026).
--
-- The PF handler wants a monthly register in his exact format (father name,
-- bank, attendance, OT, PF, advance, actual-to-pay). Plus: employee Aadhaar,
-- fixed-vs-variable salary, and a per-month attendance/OT/advance so the
-- register can be produced. PF is capped at the ₹15,000 wage ceiling (12% of
-- min(salary, 15000)) — handled in the app.
-- Additive + nullable / defaulted.

-- ── Employee master ──────────────────────────────────────────────────
alter table public.salary_employees add column if not exists aadhaar text;
alter table public.salary_employees add column if not exists father_name text;
-- Fixed = same every month; variable = amount entered per month.
alter table public.salary_employees add column if not exists salary_type text not null default 'fixed'
  check (salary_type in ('fixed', 'variable'));

-- ── Monthly payment rows ─────────────────────────────────────────────
alter table public.salary_payments add column if not exists attendance_days numeric(6,2);
alter table public.salary_payments add column if not exists ot_hours numeric(6,2);
alter table public.salary_payments add column if not exists ot_amount numeric(14,2) not null default 0;
alter table public.salary_payments add column if not exists advance numeric(14,2) not null default 0;
alter table public.salary_payments add column if not exists remarks text;

notify pgrst, 'reload schema';
