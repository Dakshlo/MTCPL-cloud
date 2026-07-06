-- 189: SALARY / PF — a completely NEW department (Daksh, Jul 2026).
--
-- Like Finance's bank-excel flow, but for EMPLOYEES: keep an employee master
-- (bank + PF details), prepare a month's salary run, export the same HDFC
-- bulk-payment sheet, mark it paid, and keep the PF record per employee.
--
-- DELIBERATELY ISOLATED: two brand-new tables only. No links to profiles,
-- vendors, bills or any existing table (creator ids are plain uuids, not FKs,
-- so this department can never block or cascade into anything else).

-- ── Employee master ─────────────────────────────────────────────────
create table if not exists public.salary_employees (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  designation      text,
  phone            text,
  -- Bank details for the HDFC bulk-payment sheet.
  bank_name        text,
  account_number   text,
  ifsc             text,
  -- HDFC beneficiary name: max 20 chars, A-Z 0-9 space period (same rule as
  -- the bill-vendor master). Kept separate so the sheet never breaks.
  beneficiary_name text,
  -- Monthly salary (gross) in rupees.
  monthly_salary   numeric(14,2) not null default 0,
  -- PF: enabled flag + UAN / PF account number + employee-share percent
  -- (default 12% of basic, editable per employee).
  pf_enabled       boolean not null default false,
  uan              text,
  pf_percent       numeric(5,2) not null default 12,
  joined_on        date,
  is_active        boolean not null default true,
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_salary_employees_active on public.salary_employees (is_active, name);

-- ── Monthly salary payments (one row per employee per month) ────────
-- The month's "run" is simply the set of rows for that month. PF record =
-- the pf_amount trail on paid rows (no third table needed).
create table if not exists public.salary_payments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.salary_employees(id) on delete cascade,
  -- First day of the salary month (e.g. 2026-07-01 = July 2026).
  month            date not null,
  -- Amounts in rupees. net = gross - pf_amount - other_deduction (+ additions).
  gross            numeric(14,2) not null default 0,
  pf_amount        numeric(14,2) not null default 0,
  other_deduction  numeric(14,2) not null default 0,
  addition         numeric(14,2) not null default 0,
  net              numeric(14,2) not null default 0,
  note             text,
  status           text not null default 'draft' check (status in ('draft','paid')),
  paid_at          timestamptz,
  paid_by          uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (employee_id, month)
);

create index if not exists idx_salary_payments_month on public.salary_payments (month desc, status);
create index if not exists idx_salary_payments_employee on public.salary_payments (employee_id, month desc);

-- LOCK DOWN: salary + bank details are sensitive. RLS ON with NO policies —
-- the anon/browser key can read NOTHING; every access goes through the app's
-- service-role client (which bypasses RLS) behind the canUseSalary role gate.
alter table public.salary_employees enable row level security;
alter table public.salary_payments enable row level security;

-- Let users SWITCH INTO the salary department. profiles.active_department is a
-- TEXT column with a CHECK constraint (mig 036 → 110); extend it to allow
-- 'salary', otherwise setActiveDepartmentAction's UPDATE fails the constraint
-- and the sidebar stays stuck on the previous department.
alter table public.profiles
  drop constraint if exists profiles_active_department_check;
alter table public.profiles
  add constraint profiles_active_department_check
    check (active_department in ('production', 'finance', 'inventory', 'invoicing', 'register', 'maintenance', 'salary'));

notify pgrst, 'reload schema';
