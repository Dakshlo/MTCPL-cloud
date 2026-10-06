-- 230: the wardrobe QR learns who you are (Daksh, Oct 2026).
--
-- Mig 229 shipped the QR with a typed name — the same accountability the
-- paper register had, which is to say none: anyone could write "Mohit".
-- Daksh: "we will show all names mohit, manthan, vivek ... when press it
-- will send OTP, then they will enter 4 digit OTP then it will login.
-- now in this they can do all in taking side. still adding item in stock
-- not."
--
-- So the name list stops being free text and becomes the roster of real
-- people, each take is signed by a phone only that person holds, and the
-- register stores the PROFILE, not a string somebody typed.
--
-- What does NOT change: this is still a take-only door. Adding stock,
-- scrap, fix-count and undo need a real app login, and the mig-229 CHECK
-- that a QR movement can only ever be an `issue` stays exactly as it is.
--
-- The code is FOUR digits here, not the two used by action_otps (mig
-- 226). That file says in its own header that it must not be reused for
-- anything that mints a session without revisiting the length — this
-- mints one, so: 10,000 codes against a 3-attempt cap, and the code only
-- ever goes to the number already on that person's profile.
--
-- Safety: one new table, one new nullable column, one CHECK tightened on
-- a set that is currently EMPTY (verified before writing this: no QR
-- movement exists yet, the mig-229 test row was deleted). Nothing that
-- predates the QR is read or rewritten.

begin;

-- ── A signed-in shift at the cupboard ──────────────────────────────
create table if not exists public.cnc_tool_sessions (
  id           uuid primary key default gen_random_uuid(),
  -- random; lives in an HttpOnly cookie on that one phone
  token        text not null unique,
  profile_id   uuid not null references public.profiles(id),
  link_id      uuid not null references public.cnc_tool_store_links(id),
  -- which company this person is taking for. Fixed at sign-in from
  -- their own profile; a developer (no vendor of their own) picks.
  vendor_id    uuid references public.vendors(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_cnc_tool_sessions_token
  on public.cnc_tool_sessions (token);
create index if not exists idx_cnc_tool_sessions_profile
  on public.cnc_tool_sessions (profile_id, expires_at desc);

-- ── Who actually took it ───────────────────────────────────────────
alter table public.cnc_tool_movements
  add column if not exists taken_by_profile_id uuid references public.profiles(id);

create index if not exists idx_cnc_tool_moves_taker
  on public.cnc_tool_movements (taken_by_profile_id)
  where taken_by_profile_id is not null;

-- A take through the QR must now name a VERIFIED person, not a typed
-- string. Replaces the mig-229 "needs a name" rule, which this implies.
do $$
begin
  alter table public.cnc_tool_movements
    drop constraint if exists cnc_tool_movements_guest_needs_name;

  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_movements_guest_needs_taker'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_guest_needs_taker
      check (
        guest_link_id is null
        or (taken_by_profile_id is not null
            and taken_by is not null
            and length(btrim(taken_by)) > 0)
      );
  end if;
end $$;

-- Service-role only, same posture as cnc_tool_store_links (mig 229) and
-- work_diary_guest_links (mig 201). The guest page reaches these rows
-- only through server code that has already checked the cookie.
alter table public.cnc_tool_sessions enable row level security;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- alter table public.cnc_tool_movements
--   drop constraint if exists cnc_tool_movements_guest_needs_taker;
-- alter table public.cnc_tool_movements
--   add constraint cnc_tool_movements_guest_needs_name
--   check (guest_link_id is null or (taken_by is not null and length(btrim(taken_by)) > 0));
-- drop index if exists public.idx_cnc_tool_moves_taker;
-- alter table public.cnc_tool_movements drop column if exists taken_by_profile_id;
-- drop table if exists public.cnc_tool_sessions;
-- notify pgrst, 'reload schema';
-- commit;
