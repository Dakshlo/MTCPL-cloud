-- 204: VEHICLES department (Daksh, Jul 2026) — vehicle document management.
--
-- Owner + developer only for now. Three pages: overview (expiry radar),
-- Commercial vehicles, Personal vehicles. Per vehicle:
--   • EMI monitor        — amount, due day-of-month, lender, start/end
--   • Government papers  — any file, uploaded straight to storage
--     (bucket "vehicle-docs", lazily created), findable any time
--   • Expiries           — insurance policy, PUC; commercial also FITNESS
--   • Notes / other info
--
-- Same service-role posture as salary: RLS on, no policies — all reads and
-- writes go through server code gated to owner / developer.

create table if not exists public.vehicles (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('commercial','personal')),
  name                 text not null,          -- display name, e.g. "TATA 407"
  reg_no               text,                   -- registration number
  make_model           text,
  -- EMI monitor (all null when the vehicle has no loan)
  emi_active           boolean not null default false,
  emi_amount           numeric,
  emi_day              int,                    -- day of month the EMI hits
  emi_lender           text,
  emi_start            date,
  emi_end              date,
  -- expiries
  insurance_company    text,
  insurance_policy_no  text,
  insurance_expiry     date,
  puc_expiry           date,
  fitness_expiry       date,                   -- commercial only (UI-gated)
  notes                text,
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now()
);

create table if not exists public.vehicle_documents (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete cascade,
  name         text not null,
  path         text not null,                  -- storage path in "vehicle-docs"
  mime         text,
  size         numeric,
  doc_type     text,                           -- RC / Insurance / PUC / Fitness / Loan / Permit / Other
  uploaded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_vehicle_documents_vehicle on public.vehicle_documents (vehicle_id);

alter table public.vehicles          enable row level security;
alter table public.vehicle_documents enable row level security;

notify pgrst, 'reload schema';
