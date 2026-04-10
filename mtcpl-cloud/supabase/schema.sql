create extension if not exists "pgcrypto";

create type public.app_role as enum (
  'owner',
  'planner',
  'block_entry',
  'slab_entry',
  'worker',
  'carving_assigner',
  'dispatch',
  'vendor'
);

create type public.block_category as enum ('Fresh', 'Reused');
create type public.block_status as enum ('available', 'reserved', 'consumed', 'discarded');
create type public.slab_status as enum (
  'open',
  'planned',
  'cutting',
  'cut_done',
  'carving_assigned',
  'carving_in_progress',
  'completed',
  'dispatched',
  'rejected'
);

create type public.cut_session_status as enum ('draft', 'approved', 'in_progress', 'closed', 'cancelled');
create type public.cut_block_status as enum ('pending_worker', 'cutting', 'done_prompt', 'done', 'rejected');
create type public.vendor_type as enum ('CNC', 'Manual');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  vendor_type public.vendor_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.app_role not null default 'worker',
  vendor_id uuid references public.vendors(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dimensions stored in inches. stone: 'PinkStone' | 'WhiteStone'
create table public.blocks (
  id text primary key,
  stone text not null check (stone in ('PinkStone', 'WhiteStone')),
  yard smallint not null check (yard in (1, 2, 3)),
  category public.block_category not null default 'Fresh',
  length_ft numeric(10,2) not null,
  width_ft numeric(10,2) not null,
  height_ft numeric(10,2) not null,
  status public.block_status not null default 'available',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.slab_requirements (
  id text primary key,
  label text not null,
  temple text not null,
  stone text,
  length_ft numeric(10,2) not null,
  width_ft numeric(10,2) not null,
  thickness_ft numeric(10,2) not null,
  source_block_id text references public.blocks(id) on delete set null,
  status public.slab_status not null default 'open',
  priority boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cut_sessions (
  id uuid primary key default gen_random_uuid(),
  session_code text not null unique,
  kerf_mm numeric(8,2) not null,
  status public.cut_session_status not null default 'draft',
  planned_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.cut_session_blocks (
  id uuid primary key default gen_random_uuid(),
  cut_session_id uuid not null references public.cut_sessions(id) on delete cascade,
  block_id text not null references public.blocks(id),
  status public.cut_block_status not null default 'pending_worker',
  layout jsonb not null default '{}'::jsonb,
  largest_remainder jsonb,
  restocked_block_id text references public.blocks(id) on delete set null,
  worker_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cut_session_slabs (
  id uuid primary key default gen_random_uuid(),
  cut_session_block_id uuid not null references public.cut_session_blocks(id) on delete cascade,
  slab_requirement_id text not null references public.slab_requirements(id),
  placed_width_ft numeric(10,2) not null,
  placed_height_ft numeric(10,2) not null,
  pos_x_ft numeric(10,2) not null,
  pos_y_ft numeric(10,2) not null,
  rotated boolean not null default false
);

create table public.carving_items (
  id uuid primary key default gen_random_uuid(),
  slab_requirement_id text not null unique references public.slab_requirements(id),
  vendor_id uuid not null references public.vendors(id),
  vendor_name text not null,
  vendor_type public.vendor_type not null,
  note text,
  status public.slab_status not null default 'carving_assigned',
  deadline_days integer,
  due_at timestamptz,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.dispatch_logs (
  id uuid primary key default gen_random_uuid(),
  carving_item_id uuid not null unique references public.carving_items(id),
  slab_requirement_id text not null references public.slab_requirements(id),
  dispatched_by uuid references public.profiles(id),
  dispatch_note text,
  dispatched_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.phone,
    'worker',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.app_role
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_vendor_id()
returns uuid
language sql
stable
as $$
  select vendor_id from public.profiles where id = auth.uid()
$$;

alter table public.vendors enable row level security;
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.slab_requirements enable row level security;
alter table public.cut_sessions enable row level security;
alter table public.cut_session_blocks enable row level security;
alter table public.cut_session_slabs enable row level security;
alter table public.carving_items enable row level security;
alter table public.dispatch_logs enable row level security;

create policy "profiles owner read all" on public.profiles
for select using (public.current_role() = 'owner');

create policy "profiles self read" on public.profiles
for select using (auth.uid() = id);

create policy "profiles owner update" on public.profiles
for update using (public.current_role() = 'owner');

create policy "vendors read by signed in users" on public.vendors
for select using (auth.role() = 'authenticated');

create policy "owner full vendors" on public.vendors
for all using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "blocks read by allowed roles" on public.blocks
for select using (public.current_role() in ('owner', 'planner', 'block_entry', 'worker'));

create policy "blocks edit by owner planner block entry" on public.blocks
for all using (public.current_role() in ('owner', 'planner', 'block_entry'))
with check (public.current_role() in ('owner', 'planner', 'block_entry'));

create policy "blocks worker cutting update" on public.blocks
for all using (public.current_role() in ('owner', 'worker'))
with check (public.current_role() in ('owner', 'worker'));

create policy "slabs read by allowed roles" on public.slab_requirements
for select using (public.current_role() in ('owner', 'planner', 'slab_entry', 'worker'));

create policy "slabs edit by owner planner slab entry" on public.slab_requirements
for all using (public.current_role() in ('owner', 'planner', 'slab_entry'))
with check (public.current_role() in ('owner', 'planner', 'slab_entry'));

create policy "slabs worker cutting update" on public.slab_requirements
for all using (public.current_role() in ('owner', 'worker'))
with check (public.current_role() in ('owner', 'worker'));

create policy "cut sessions read by owner planner worker" on public.cut_sessions
for select using (public.current_role() in ('owner', 'planner', 'worker'));

create policy "cut sessions write by owner planner" on public.cut_sessions
for all using (public.current_role() in ('owner', 'planner'))
with check (public.current_role() in ('owner', 'planner'));

create policy "cut blocks read by owner planner worker" on public.cut_session_blocks
for select using (public.current_role() in ('owner', 'planner', 'worker'));

create policy "cut blocks write by owner planner" on public.cut_session_blocks
for all using (public.current_role() in ('owner', 'planner'))
with check (public.current_role() in ('owner', 'planner'));

create policy "cut blocks worker update" on public.cut_session_blocks
for update using (public.current_role() in ('owner', 'worker'))
with check (public.current_role() in ('owner', 'worker'));

create policy "cut slabs read by owner planner worker" on public.cut_session_slabs
for select using (public.current_role() in ('owner', 'planner', 'worker'));

create policy "cut slabs write by owner planner" on public.cut_session_slabs
for all using (public.current_role() in ('owner', 'planner'))
with check (public.current_role() in ('owner', 'planner'));
