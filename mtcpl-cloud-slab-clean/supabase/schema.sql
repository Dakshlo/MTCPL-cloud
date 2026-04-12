create extension if not exists "pgcrypto";

create type public.app_role as enum (
  'owner',
  'office',
  'assigner',
  'vendor',
  'dispatch'
);

create type public.vendor_type as enum ('CNC', 'Manual');
create type public.dimension_mode as enum ('ft_inch', 'decimal_ft');
create type public.slab_status as enum (
  'entered',
  'ready_for_assignment',
  'assigned',
  'in_progress',
  'completed_pending_approval',
  'approved_ready_to_ship',
  'denied_rework',
  'dispatched'
);
create type public.approval_decision as enum ('approved', 'denied');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  vendor_type public.vendor_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.temples (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code_prefix text not null unique,
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  id boolean primary key default true check (id = true),
  dimension_mode public.dimension_mode not null default 'ft_inch',
  updated_at timestamptz not null default now()
);

insert into public.system_settings (id, dimension_mode)
values (true, 'ft_inch')
on conflict (id) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.app_role not null default 'office',
  vendor_id uuid references public.vendors(id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_temple_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  temple_id uuid not null references public.temples(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, temple_id)
);

create table public.slabs (
  id uuid primary key default gen_random_uuid(),
  slab_code text not null unique,
  temple_id uuid not null references public.temples(id),
  temple_name text not null,
  component text not null,
  group_name text,
  group_color text,
  stone_type text not null check (stone_type in ('Makrana', 'Pinkstone')) default 'Pinkstone',
  length_ft integer not null default 0,
  length_in numeric(5,2) not null default 0,
  width_ft integer not null default 0,
  width_in numeric(5,2) not null default 0,
  thickness_ft integer not null default 0,
  thickness_in numeric(5,2) not null default 0,
  length_decimal_ft numeric(8,2) not null,
  width_decimal_ft numeric(8,2) not null,
  thickness_decimal_ft numeric(8,2) not null,
  cubic_ft numeric(10,3) not null,
  priority text not null default 'Medium',
  needed_by date,
  notes text,
  status public.slab_status not null default 'entered',
  assigned_vendor_id uuid references public.vendors(id) on delete set null,
  assigned_vendor_name text,
  outside_price numeric(10,2),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index slabs_temple_status_idx on public.slabs(temple_id, status);
create index slabs_needed_by_idx on public.slabs(needed_by);

create table public.vendor_completion_photos (
  id uuid primary key default gen_random_uuid(),
  slab_id uuid not null references public.slabs(id) on delete cascade,
  file_path text not null,
  file_url text not null,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create table public.approval_reviews (
  id uuid primary key default gen_random_uuid(),
  slab_id uuid not null references public.slabs(id) on delete cascade,
  decision public.approval_decision not null,
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz not null default now()
);

create table public.dispatch_records (
  id uuid primary key default gen_random_uuid(),
  slab_id uuid not null unique references public.slabs(id) on delete cascade,
  truck_no text,
  dispatch_note text,
  site_name text,
  loaded_at timestamptz not null default now(),
  dispatched_by uuid references public.profiles(id)
);

insert into storage.buckets (id, name, public)
values ('vendor-completion', 'vendor-completion', true)
on conflict (id) do nothing;

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
    'office',
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
alter table public.temples enable row level security;
alter table public.system_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.user_temple_access enable row level security;
alter table public.slabs enable row level security;
alter table public.vendor_completion_photos enable row level security;
alter table public.approval_reviews enable row level security;
alter table public.dispatch_records enable row level security;

create policy "profiles owner read all" on public.profiles
for select using (public.current_role() = 'owner');

create policy "profiles self read" on public.profiles
for select using (auth.uid() = id);

create policy "profiles owner update" on public.profiles
for update using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "vendors read all signed in" on public.vendors
for select using (auth.role() = 'authenticated');

create policy "vendors owner full" on public.vendors
for all using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "temples read all signed in" on public.temples
for select using (auth.role() = 'authenticated');

create policy "temples owner full" on public.temples
for all using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "settings read all signed in" on public.system_settings
for select using (auth.role() = 'authenticated');

create policy "settings owner full" on public.system_settings
for all using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "user temple access owner read all" on public.user_temple_access
for select using (public.current_role() = 'owner');

create policy "user temple access self read" on public.user_temple_access
for select using (user_id = auth.uid());

create policy "user temple access owner full" on public.user_temple_access
for all using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy "slabs read core roles" on public.slabs
for select using (public.current_role() in ('owner', 'office', 'assigner', 'dispatch'));

create policy "slabs read vendor own" on public.slabs
for select using (public.current_role() = 'vendor' and assigned_vendor_id = public.current_vendor_id());

create policy "slabs owner office full" on public.slabs
for all using (public.current_role() in ('owner', 'office'))
with check (public.current_role() in ('owner', 'office'));

create policy "slabs assigner update" on public.slabs
for update using (public.current_role() in ('owner', 'assigner'))
with check (public.current_role() in ('owner', 'assigner'));

create policy "slabs dispatch update" on public.slabs
for update using (public.current_role() in ('owner', 'dispatch'))
with check (public.current_role() in ('owner', 'dispatch'));

create policy "slabs vendor update own" on public.slabs
for update using (public.current_role() = 'vendor' and assigned_vendor_id = public.current_vendor_id())
with check (public.current_role() = 'vendor' and assigned_vendor_id = public.current_vendor_id());

create policy "photos read core roles" on public.vendor_completion_photos
for select using (public.current_role() in ('owner', 'office', 'assigner', 'dispatch'));

create policy "photos read vendor own" on public.vendor_completion_photos
for select using (
  public.current_role() = 'vendor'
  and exists (
    select 1 from public.slabs
    where slabs.id = vendor_completion_photos.slab_id
      and slabs.assigned_vendor_id = public.current_vendor_id()
  )
);

create policy "photos owner office full" on public.vendor_completion_photos
for all using (public.current_role() in ('owner', 'office'))
with check (public.current_role() in ('owner', 'office'));

create policy "photos vendor insert own" on public.vendor_completion_photos
for insert with check (
  public.current_role() = 'vendor'
  and exists (
    select 1 from public.slabs
    where slabs.id = vendor_completion_photos.slab_id
      and slabs.assigned_vendor_id = public.current_vendor_id()
  )
);

create policy "photos vendor delete own" on public.vendor_completion_photos
for delete using (
  public.current_role() = 'vendor'
  and exists (
    select 1 from public.slabs
    where slabs.id = vendor_completion_photos.slab_id
      and slabs.assigned_vendor_id = public.current_vendor_id()
  )
);

create policy "approval read owner office dispatch" on public.approval_reviews
for select using (public.current_role() in ('owner', 'office', 'dispatch'));

create policy "approval read vendor own" on public.approval_reviews
for select using (
  public.current_role() = 'vendor'
  and exists (
    select 1 from public.slabs
    where slabs.id = approval_reviews.slab_id
      and slabs.assigned_vendor_id = public.current_vendor_id()
  )
);

create policy "approval owner office full" on public.approval_reviews
for all using (public.current_role() in ('owner', 'office'))
with check (public.current_role() in ('owner', 'office'));

create policy "dispatch read owner office dispatch assigner" on public.dispatch_records
for select using (public.current_role() in ('owner', 'office', 'dispatch', 'assigner'));

create policy "dispatch read vendor own" on public.dispatch_records
for select using (
  public.current_role() = 'vendor'
  and exists (
    select 1 from public.slabs
    where slabs.id = dispatch_records.slab_id
      and slabs.assigned_vendor_id = public.current_vendor_id()
  )
);

create policy "dispatch owner dispatch full" on public.dispatch_records
for all using (public.current_role() in ('owner', 'dispatch'))
with check (public.current_role() in ('owner', 'dispatch'));

create policy "vendor completion bucket read" on storage.objects
for select using (bucket_id = 'vendor-completion' and auth.role() = 'authenticated');

create policy "vendor completion bucket insert" on storage.objects
for insert with check (
  bucket_id = 'vendor-completion'
  and public.current_role() in ('owner', 'office', 'vendor')
);

create policy "vendor completion bucket delete" on storage.objects
for delete using (
  bucket_id = 'vendor-completion'
  and public.current_role() in ('owner', 'office', 'vendor')
);

insert into public.temples (name, code_prefix, display_order)
values
  ('Umia Mata', 'UM', 1),
  ('Ram Mandir', 'RM', 2),
  ('Agroha Dham', 'AG', 3)
on conflict (name) do nothing;

insert into public.vendors (name, vendor_type)
values
  ('Mohit', 'CNC'),
  ('Manthan', 'CNC'),
  ('Alkesh', 'CNC'),
  ('Pintu Bhai', 'Manual')
on conflict (name) do nothing;
