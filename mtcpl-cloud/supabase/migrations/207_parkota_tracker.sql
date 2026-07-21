-- 207 — Parkota Pillar Tracker: shared, server-backed state
--
-- The tracker (public/parkota-tracker.html, served at /parkota) used to keep
-- everything in the browser's localStorage, so every device had its own private
-- copy and nobody saw anybody else's progress. This moves the state into the
-- database so the board is live and shared, exactly like the rest of the app.
--
-- The whole tracker state is one JSON document: { v, nid, pts[], elems, linear,
-- stock, updated }. `pts` is the 645-pillar array. We keep it as a single jsonb
-- row rather than shredding it into tables because the client is a self-contained
-- canvas app that thinks in terms of that one document — and because saves are
-- merged per-pillar in the API layer, so a single row does not mean
-- last-writer-wins (see /api/parkota/state).
--
-- Access is limited to owner / senior_incharge / carving_head / developer. That
-- is enforced in the API route and in middleware; RLS is on with NO policies so
-- the tables are unreachable with the anon/publishable key — only the
-- service-role client used by our server code can touch them.

create table if not exists parkota_state (
  id          text primary key,
  state       jsonb       not null default '{}'::jsonb,
  -- bumped on every successful save; the client sends the rev it was working
  -- from so the server can tell it "you were stale, here is the merged state".
  rev         bigint      not null default 0,
  updated_at  timestamptz,
  updated_by  uuid,
  constraint parkota_state_single_row check (id = 'main')
);

alter table parkota_state enable row level security;

insert into parkota_state (id, state, rev)
values ('main', '{}'::jsonb, 0)
on conflict (id) do nothing;

-- Periodic full-state snapshots. Site progress is hand-entered over months, so
-- a bad merge or a mistaken bulk edit would be expensive to redo. The API writes
-- at most one snapshot every 30 minutes (cheap insurance, bounded growth).
create table if not exists parkota_snapshots (
  id          uuid primary key default gen_random_uuid(),
  state       jsonb       not null,
  rev         bigint      not null,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

alter table parkota_snapshots enable row level security;

create index if not exists parkota_snapshots_created_idx
  on parkota_snapshots (created_at desc);

notify pgrst, 'reload schema';
