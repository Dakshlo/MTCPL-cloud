-- 186: Work Diary v2 (Daksh + Naresh, Jul 2026).
--
--   • URGENT flag — set at creation or later; urgent entries glow + sort on top
--     and make the topbar Work Diary pill glow with a moving border.
--   • FILE ATTACHMENTS — any file on the entry itself (remark_id null) or on a
--     remark. Files live in the public "work-diary" storage bucket (created
--     lazily by prepareDiaryUploadsAction via createBucket, like dev-transfer);
--     the browser uploads DIRECTLY to storage via signed upload URLs so there's
--     no server body-size limit.
-- Additive + idempotent.

alter table public.work_diary_entries add column if not exists urgent boolean not null default false;

create table if not exists public.work_diary_files (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.work_diary_entries(id) on delete cascade,
  -- null = attached to the entry itself; set = attached to that remark
  remark_id    uuid references public.work_diary_remarks(id) on delete cascade,
  name         text not null,
  path         text not null,
  mime         text,
  size         bigint,
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_wd_files_entry on public.work_diary_files (entry_id);

notify pgrst, 'reload schema';
