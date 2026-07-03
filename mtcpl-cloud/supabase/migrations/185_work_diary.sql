-- 185: Work Diary (Daksh + Naresh, Jul 2026).
--
-- A digital "kaam ka register" for ALL users: an entry = one register row
-- (activity, from whom, who's included, date to complete). It stays OPEN —
-- pinned on everyone's diary — until someone included closes it. Multi-day
-- work carries a remarks thread ("current status") from any included user.
--
-- Rules (confirmed):
--   • anyone included (or the creator) can CLOSE / reopen;
--   • owner + developer see ALL entries; other roles only entries they created
--     or are included in;
--   • only the CREATOR (or owner/developer) can DELETE an entry;
--   • named groups = reusable member sets for quick picking.
-- Accessed from a topbar "Work Diary" pill (next to Tasks) + /diary page.

create table if not exists public.work_diary_entries (
  id          uuid primary key default gen_random_uuid(),
  activity    text not null,
  details     text,
  created_by  uuid not null references public.profiles(id),
  due_date    date not null,
  closed_at   timestamptz,
  closed_by   uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.work_diary_participants (
  entry_id    uuid not null references public.work_diary_entries(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id),
  primary key (entry_id, profile_id)
);

create table if not exists public.work_diary_remarks (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.work_diary_entries(id) on delete cascade,
  author      uuid not null references public.profiles(id),
  body        text not null default '',
  -- 'remark' (a status note) | 'closed' | 'reopened' (system lines in the thread)
  kind        text not null default 'remark',
  created_at  timestamptz not null default now()
);

create table if not exists public.work_diary_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.work_diary_group_members (
  group_id    uuid not null references public.work_diary_groups(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id),
  primary key (group_id, profile_id)
);

create index if not exists idx_wd_participants_profile on public.work_diary_participants (profile_id);
create index if not exists idx_wd_entries_open on public.work_diary_entries (due_date) where closed_at is null;
create index if not exists idx_wd_remarks_entry on public.work_diary_remarks (entry_id, created_at);

notify pgrst, 'reload schema';
