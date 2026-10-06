-- 229: CNC tool store — the wardrobe QR (Daksh, Oct 2026).
--
-- A sticker on the office wardrobe door. Whoever opens it scans, says who
-- they are, and takes a tool — no login, on their own phone. It replaces
-- the register that lives next to the cupboard, and nothing else.
--
-- Daksh: "to add stock in store this can't work, user will need to login
-- as usual. but to take they can scan the QR."
--
-- So the link is deliberately the WEAKEST credential in the app:
--   • it can only ever record an `issue` (a take) — enforced below by a
--     CHECK, not merely by which screen is served;
--   • it can never add stock, scrap, fix a count, or undo anything;
--   • it reads only tool names and counts — no money, no vendor
--     balances, no bills;
--   • it carries a per-day ceiling so a leaked sticker cannot be used to
--     bury the register under junk overnight;
--   • it is revocable, and revoking it is one UPDATE.
--
-- Every take still names a person (`taken_by`) and a vendor, exactly like
-- a take recorded inside the app — the only difference is that
-- `entered_by` is null and `guest_link_id` says which sticker it came
-- through, so the master register can show "via QR · Office wardrobe".
--
-- Safety: new table + one nullable column. No existing row is read or
-- rewritten, and the tool store keeps working untouched if nobody ever
-- creates a link.

begin;

-- ── The sticker ────────────────────────────────────────────────────
create table if not exists public.cnc_tool_store_links (
  id          uuid primary key default gen_random_uuid(),
  -- URL-safe random; /guest/tools/<token>
  token       text not null unique,
  -- what is printed under the QR: "Office wardrobe"
  label       text not null,
  is_active   boolean not null default true,
  -- Takes allowed through this sticker per IST day. A real cupboard sees
  -- a few dozen; this only bites on abuse.
  daily_cap   integer not null default 200,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id)
);

create index if not exists idx_cnc_tool_links_token
  on public.cnc_tool_store_links (token) where is_active;

-- ── Where a movement came from ─────────────────────────────────────
alter table public.cnc_tool_movements
  add column if not exists guest_link_id uuid references public.cnc_tool_store_links(id);

create index if not exists idx_cnc_tool_moves_guest_link
  on public.cnc_tool_movements (guest_link_id) where guest_link_id is not null;

-- The QR can ONLY take. Anything else through a link is rejected by the
-- database, whatever the application layer believes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_movements_guest_issue_only'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_guest_issue_only
      check (guest_link_id is null or kind = 'issue');
  end if;
end $$;

-- A take through the QR must still say who took it — the whole point of
-- the register. Inside the app a name is required by the form; here it is
-- required by the table.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_movements_guest_needs_name'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_guest_needs_name
      check (guest_link_id is null or (taken_by is not null and length(btrim(taken_by)) > 0));
  end if;
end $$;

-- Service-role only, same posture as work_diary_guest_links (mig 201) and
-- the salary tables: the guest page runs entirely through server code
-- that validates the token first. No policies = no anon reach.
alter table public.cnc_tool_store_links enable row level security;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- alter table public.cnc_tool_movements
--   drop constraint if exists cnc_tool_movements_guest_needs_name,
--   drop constraint if exists cnc_tool_movements_guest_issue_only;
-- drop index if exists public.idx_cnc_tool_moves_guest_link;
-- alter table public.cnc_tool_movements drop column if exists guest_link_id;
-- drop table if exists public.cnc_tool_store_links;
-- notify pgrst, 'reload schema';
-- commit;
