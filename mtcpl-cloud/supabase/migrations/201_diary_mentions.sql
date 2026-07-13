-- 201: Work Diary — @mentions + WhatsApp ping + guest reply links (Daksh, Jul 2026).
--
--   • work_diary_remarks.mentions — profile ids @-tagged in the message. The
--     picker only offers people INCLUDED in that entry.
--   • work_diary_guest_links — the temporary no-login links sent on WhatsApp
--     when someone is mentioned: /guest/diary/<token> opens a mobile chat view
--     of that entry where the mentioned person can reply WITHOUT logging in.
--     One row per (mention ping); expires after 48 h.
--
-- (Unsend needs no schema — deleting your own remark within 10 minutes is
-- enforced in the server action from created_at.)

alter table public.work_diary_remarks
  add column if not exists mentions uuid[] not null default '{}';

create table if not exists public.work_diary_guest_links (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  entry_id    uuid not null references public.work_diary_entries(id) on delete cascade,
  -- who this link was issued TO (their replies post under this profile)
  profile_id  uuid not null references public.profiles(id),
  created_by  uuid not null references public.profiles(id),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_wd_guest_token on public.work_diary_guest_links (token);
create index if not exists idx_wd_guest_entry on public.work_diary_guest_links (entry_id);

-- Service-role only (same posture as the salary tables) — the guest page runs
-- entirely through server code that validates the token.
alter table public.work_diary_guest_links enable row level security;

notify pgrst, 'reload schema';
