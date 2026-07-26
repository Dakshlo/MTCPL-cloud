-- 214 — Vehicles: registration date replaces make/model (Daksh, Jul 2026)
--
-- The team had been typing the registration DATE into the free-text "Make /
-- model" field (values like "24/02/2023", "07-01-2010"). So we formalise it:
-- a proper `registration_date` date column, edited via a date picker. RC no.
-- (213) is dropped from the form at the same time — only RC expiry stays.
--
-- Backfill: copy any make_model that is a DD/MM/YYYY or DD-MM-YYYY date into
-- registration_date (Indian day-first). Non-date make_model values are left
-- alone. make_model + rc_no columns are kept (non-destructive) but unused.

alter table public.vehicles
  add column if not exists registration_date date;

do $$
declare
  r record;
begin
  for r in
    select id, make_model
    from public.vehicles
    where registration_date is null
      and make_model is not null
      and make_model ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}$'
  loop
    begin
      update public.vehicles
        set registration_date = to_date(replace(r.make_model, '-', '/'), 'DD/MM/YYYY')
        where id = r.id;
    exception when others then
      -- unparseable (e.g. impossible day/month) — skip, leave null
      null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
