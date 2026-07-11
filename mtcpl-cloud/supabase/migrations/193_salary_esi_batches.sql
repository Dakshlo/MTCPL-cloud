-- 193: Employees dept — ESI + payment BATCHES (Daksh, Jul 2026).
--
-- 1. ESI on the employee master: enabled flag + ESI number + employee-share
--    percent (default 1%). ESI = esi_percent% of the month's earned gross
--    (same base as salary; no wage ceiling — per Daksh's rule).
-- 2. esi_amount on salary_payments (deducted alongside PF; net = gross − PF −
--    ESI + OT − advance − deduction + addition).
-- 3. salary_batches — "Prepare month" now creates a BATCH (scoped to an
--    organization / designation / picked employees). The HDFC bulk-payment
--    sheet is generated PER BATCH and locks the batch afterwards
--    (hdfc_generated_at, "IN HDFC FILE") so the same batch can never be
--    exported twice → no duplicate payments. Mark-paid is per batch too.
--
-- Additive + isolated (no FKs outside the salary tables, same posture as 189).

alter table public.salary_employees add column if not exists esi_enabled boolean not null default false;
alter table public.salary_employees add column if not exists esi_number  text;
alter table public.salary_employees add column if not exists esi_percent numeric(5,2) not null default 1;

alter table public.salary_payments add column if not exists esi_amount numeric(14,2) not null default 0;
alter table public.salary_payments add column if not exists batch_id   uuid;
create index if not exists idx_salary_payments_batch on public.salary_payments (batch_id);

create table if not exists public.salary_batches (
  id                 uuid primary key default gen_random_uuid(),
  -- First day of the salary month this batch belongs to.
  month              date not null,
  -- Human label, e.g. "Main Office · July 2026" or "Picked · 4 employees".
  label              text not null,
  -- How the batch was scoped: { kind: all|organization|designation|employees, values: [...] }.
  scope              jsonb,
  status             text not null default 'draft' check (status in ('draft','paid')),
  -- Set the moment the HDFC sheet is generated — locks the batch ("IN HDFC
  -- FILE"); cleared only by the owner/developer unlock action.
  hdfc_generated_at  timestamptz,
  hdfc_generated_by  uuid,
  paid_at            timestamptz,
  paid_by            uuid,
  created_by         uuid,
  created_at         timestamptz not null default now()
);
create index if not exists idx_salary_batches_month on public.salary_batches (month desc, created_at desc);

-- Same lock-down as the other salary tables: RLS ON, no policies — access is
-- service-role only behind the app's role gate.
alter table public.salary_batches enable row level security;

notify pgrst, 'reload schema';
