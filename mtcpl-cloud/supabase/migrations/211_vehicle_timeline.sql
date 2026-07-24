-- 211 — Vehicles: per-vehicle change timeline (Daksh, Jul 2026)
--
-- "assume i added a vehicle and after 10 days there is insurance renewal …
--  i want keep both" — editing used to overwrite silently, losing the old
-- insurance/EMI info. Now every save writes an event: 'created' when the
-- vehicle is added, 'updated' with a field-by-field diff (old → new) on every
-- edit. The timeline renders inside the Edit form, so a renewal shows e.g.
--   24 Jul 2026 · NARESH — Insurance company: TATA AIG → ICICI LOMBARD
-- and the old policy is never lost.
--
-- Goes with the app-side rule shipped alongside: vehicle DETAILS (reg no /
-- name / make / owner) are locked after creation for owner + accountant —
-- only the developer can change identity; EMI + expiries stay editable.
--
-- RLS on with NO policies — server-only via the service-role client, same
-- pattern as the other new tables (189 salary, 207 parkota).

create table if not exists public.vehicle_events (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid not null references public.vehicles(id) on delete cascade,
  event_type       text not null check (event_type in ('created','updated')),
  -- [{ field, label, from, to }] — human-readable diff, empty for 'created'
  changes          jsonb not null default '[]'::jsonb,
  created_by       uuid references public.profiles(id),
  created_by_name  text,
  created_at       timestamptz not null default now()
);

alter table public.vehicle_events enable row level security;

create index if not exists vehicle_events_vehicle_idx
  on public.vehicle_events (vehicle_id, created_at desc);

notify pgrst, 'reload schema';
