-- 217 — a system_settings status row for every department
--
-- Migration 036 created production/finance/inventory, and 038 added invoicing.
-- Four departments have been added since (register, maintenance, salary,
-- vehicles) and none of them got a row — so the Settings maintenance card had
-- no way to take them down, and the toggle would have failed silently even if
-- it had: the action used UPDATE ... WHERE key = ?, which matches zero rows on
-- a missing key and is reported by PostgREST as SUCCESS.
--
-- The action is now an upsert with a rowcount check, so it would create these
-- on first use anyway. Seeding them here means the cards read their real
-- status from the very first page load rather than a fallback, and a reader
-- can see the full set in one place.
--
-- Idempotent: ON CONFLICT DO NOTHING, so an existing row (and any department
-- currently taken down) is never touched.
--
-- Changes no application data. Rollback: delete the four keys below.

insert into system_settings (key, value)
select k, '{"down": false, "message": null}'::jsonb
from (values
  ('register_status'),
  ('maintenance_status'),
  ('salary_status'),
  ('vehicles_status')
) as t(k)
on conflict (key) do nothing;

-- Verify — every department in src/lib/departments.ts must appear here, plus
-- the global system_status row:
--   select key, value->>'down' as down from system_settings
--   where key like '%_status' order by key;
