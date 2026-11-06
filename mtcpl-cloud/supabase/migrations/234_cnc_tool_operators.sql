-- ──────────────────────────────────────────────────────────────────
-- Migration 234 — the men under a vendor, and who keeps the store
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh, Nov 2026: "make it this way vendor can enrol new operator
-- under them from their account. eg i am mohit, i scan the qr code,
-- enter otp, i see place where i can add operator eg shyam and his
-- number. so next time shyam can also login from the login thing, his
-- name will show under mohit. and if he take anything from stock, in
-- our dashboard register it will show as shyam under mohit."
--
-- ── Why operators are NOT profiles ─────────────────────────────────
--
-- The obvious build is "make Shyam a user with role vendor". It is the
-- wrong one. A profile is an APP LOGIN: it can sign in at /login and
-- reach the vendor portal. Minting those from a sticker taped to a
-- cupboard door would put account creation back on the public internet
-- — which is exactly how the July 2026 bot run put two thousand junk
-- users in this database, after which signups were switched off and
-- Settings → Add user became the only way in. That stays true.
--
-- So an operator is a tool-store-only identity: a name, a number, and
-- the vendor who vouched for them. It can sign in at the cupboard QR
-- and take a tool. It cannot sign in to the app, cannot see a single
-- other screen, and is created by a vendor who is themselves holding a
-- live OTP session — never by an anonymous scan.
--
-- ── And who keeps the store ────────────────────────────────────────
--
-- "put all 3 under owner name — me, nikhil, and vinay." The store was
-- developer-only (v1, mig 227). Rather than hand two owners the whole
-- developer surface to let them top up a cupboard, this adds the same
-- per-person flag the cutting module already uses (can_approve_cuts,
-- can_approve_bills): one boolean, off for everybody, on for the three
-- named below.
-- ──────────────────────────────────────────────────────────────────

begin;

-- ── 1. Who may keep the store ─────────────────────────────────────

alter table public.profiles
  add column if not exists can_keep_tool_store boolean not null default false;

comment on column public.profiles.can_keep_tool_store is
  'Mig 234 — may open and fill the CNC tool store (/tools) without being a '
  'developer. Same shape as can_approve_cuts: off for everyone, granted by '
  'name. Does NOT grant anything else in the app.';

-- Daksh, Nikhil, Vinay. Matched on the last ten digits so the country
-- code written on a row cannot make this miss.
update public.profiles
   set can_keep_tool_store = true
 where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) in (
         '8003689760',  -- DAKSH  (developer — already had it by role)
         '7597854979',  -- NIKHIL (owner)
         '7737617566'   -- VINAY  (owner)
       );

-- ── 2. The operators themselves ───────────────────────────────────

create table if not exists public.cnc_tool_operators (
  id          uuid primary key default gen_random_uuid(),
  -- The company this man works for. The whole point of the row: the
  -- register groups by this, so a take reads "Shyam, under MOHIT".
  vendor_id   uuid not null references public.vendors(id) on delete restrict,
  -- The vendor principal who added him, from their own OTP session.
  -- Someone is always answerable for an operator existing.
  enrolled_by uuid not null references public.profiles(id),
  name        text not null
                check (length(btrim(name)) >= 2 and length(name) <= 60),
  -- Digits as given; the index below compares the last ten, which is
  -- what actually identifies an Indian mobile whatever the prefix.
  phone       text not null
                check (length(regexp_replace(phone, '\D', '', 'g')) between 10 and 15),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references public.profiles(id),
  constraint cnc_tool_operators_removed_pair
    check ((removed_at is null) = (removed_by is null)),
  constraint cnc_tool_operators_removed_is_off
    check (removed_at is null or is_active = false)
);

comment on table public.cnc_tool_operators is
  'Mig 234 — a man working under a CNC vendor, enrolled by that vendor at the '
  'wardrobe QR. Tool store only: this is NOT an app login and has no profile.';

-- One live operator per number, across every vendor. Two rows ringing
-- the same phone would put two names on one OTP.
create unique index if not exists cnc_tool_operators_live_phone_idx
  on public.cnc_tool_operators (right(regexp_replace(phone, '\D', '', 'g'), 10))
  where is_active;

create index if not exists cnc_tool_operators_vendor_idx
  on public.cnc_tool_operators (vendor_id, name)
  where is_active;

-- ── 3. A session can belong to an operator ────────────────────────

alter table public.cnc_tool_sessions
  add column if not exists operator_id uuid references public.cnc_tool_operators(id);

alter table public.cnc_tool_sessions
  alter column profile_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_sessions_one_signer'
  ) then
    alter table public.cnc_tool_sessions
      add constraint cnc_tool_sessions_one_signer
      check ((profile_id is not null) <> (operator_id is not null));
  end if;
end $$;

create index if not exists cnc_tool_sessions_operator_idx
  on public.cnc_tool_sessions (operator_id, expires_at desc)
  where operator_id is not null;

-- ── 4. A take can be signed by an operator ────────────────────────

alter table public.cnc_tool_movements
  add column if not exists taken_by_operator_id uuid references public.cnc_tool_operators(id);

create index if not exists cnc_tool_moves_operator_idx
  on public.cnc_tool_movements (taken_by_operator_id)
  where taken_by_operator_id is not null;

do $$
begin
  -- Exactly one signer, or none at all (a keeper's own stock line).
  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_movements_one_signer'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_one_signer
      check (taken_by_profile_id is null or taken_by_operator_id is null);
  end if;

  -- Mig 230 required a PROFILE behind every QR take. An operator is now
  -- an equally good signature — but something still has to sign.
  alter table public.cnc_tool_movements
    drop constraint if exists cnc_tool_movements_guest_needs_taker;

  alter table public.cnc_tool_movements
    add constraint cnc_tool_movements_guest_needs_taker
    check (
      guest_link_id is null
      or ((taken_by_profile_id is not null or taken_by_operator_id is not null)
          and taken_by is not null
          and length(btrim(taken_by)) > 0)
    );
end $$;

comment on column public.cnc_tool_movements.taken_by_operator_id is
  'Mig 234 — set when the taker was an operator enrolled under a vendor '
  'rather than someone with a profile. vendor_id on the same row carries '
  'the company, which is how the register groups them.';

-- ── 5. Locked down like the rest of the module ────────────────────
-- RLS on, no policies: the service-role key bypasses it and every other
-- client is refused outright. Same posture as cnc_tool_sessions.

alter table public.cnc_tool_operators enable row level security;

notify pgrst, 'reload schema';

commit;
