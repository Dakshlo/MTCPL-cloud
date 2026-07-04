-- 188: Work Diary — make the "date to complete" OPTIONAL (Daksh, Jul 2026).
-- Sometimes an entry is just a note with no deadline; only date-related info
-- (due / overdue / due-today) shows when a date is actually set.
alter table public.work_diary_entries alter column due_date drop not null;

notify pgrst, 'reload schema';
