-- ──────────────────────────────────────────────────────────────────────
-- Carving Phase 2.1 — additive-only schema changes
-- Run this in the Supabase SQL editor. All statements are idempotent.
-- No existing tables/columns are modified; only additions.
-- ──────────────────────────────────────────────────────────────────────

-- 1. Extend carving_items with review + photo + phase fields
alter table public.carving_items
  add column if not exists review_approved_at timestamptz,
  add column if not exists review_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists progress_phase text,
  add column if not exists review_notes text,
  add column if not exists photo_urls jsonb not null default '[]'::jsonb,
  add column if not exists cnc_machine_id uuid;

-- 2. CNC machines table — vendor_id + machine_code (unique per vendor)
create table if not exists public.cnc_machines (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  machine_code text not null,
  operator_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (vendor_id, machine_code)
);

-- 3. Hook the cnc_machine_id FK now that the table exists
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'carving_items_cnc_machine_id_fkey'
  ) then
    alter table public.carving_items
      add constraint carving_items_cnc_machine_id_fkey
      foreign key (cnc_machine_id) references public.cnc_machines(id) on delete set null;
  end if;
end $$;

-- 4. Full event history for each carving job
create table if not exists public.carving_job_events (
  id uuid primary key default gen_random_uuid(),
  carving_item_id uuid not null references public.carving_items(id) on delete cascade,
  event_type text not null,   -- 'assigned' | 'started' | 'phase_update' | 'photo_added' | 'completed' | 'approved' | 'rejected' | 'dispatched' | 'reassigned' | 'cancelled'
  message text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists carving_job_events_item_idx
  on public.carving_job_events (carving_item_id, created_at desc);

-- 5. RLS: allow signed-in users to read carving data the app needs.
--    Writes happen through server actions using the admin client, so
--    we just need permissive read policies here. Row filtering by
--    vendor_id happens in the server code for now (RLS tightening in Phase 2.2).

alter table public.cnc_machines enable row level security;
alter table public.carving_job_events enable row level security;

drop policy if exists "cnc_machines signed_in read" on public.cnc_machines;
create policy "cnc_machines signed_in read" on public.cnc_machines
  for select using (auth.role() = 'authenticated');

drop policy if exists "carving_job_events signed_in read" on public.carving_job_events;
create policy "carving_job_events signed_in read" on public.carving_job_events
  for select using (auth.role() = 'authenticated');

-- 6. (Already exists in schema.sql but in case this is a fresh dev env,
--    make sure carving_items and dispatch_logs have permissive read.)
do $$ begin
  perform 1 from pg_tables where schemaname = 'public' and tablename = 'carving_items';
  if found then
    drop policy if exists "carving_items signed_in read" on public.carving_items;
    create policy "carving_items signed_in read" on public.carving_items
      for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────
-- End of Carving Phase 2.1 migration.
-- ──────────────────────────────────────────────────────────────────────
