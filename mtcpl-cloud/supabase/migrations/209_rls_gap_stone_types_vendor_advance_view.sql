-- 209 — Close the last two anonymous-read holes
--
-- After 208 landed, a full external sweep (all 102 objects PostgREST exposes,
-- probed with the anon key as a logged-out stranger) turned up two more that
-- migration 208 did not cover, because neither is created by a `create table`
-- in supabase/migrations and so a source scan could not see them:
--
--     stone_types             6 rows  — all 6 readable with no login
--     vendor_advance_balance  7 rows  — all 7 readable with no login
--
-- These need DIFFERENT fixes from each other — see below.

-- ── 1. stone_types (a real table) ───────────────────────────────────
-- RLS on, PLUS an authenticated read policy. The policy is NOT optional
-- here: src/app/(app)/slabs/view/page.tsx reads this table through
-- createDataClient(role), which only returns the service-role admin client
-- for `developer` — every other role queries as their own authenticated
-- user and IS subject to RLS. Enabling RLS with no policy would empty the
-- stone filter on View Inventory for everyone except the developer.
--
-- `authenticated_read_all` is the same policy name/shape migration 029 gave
-- the ~100 other tables, so this just brings stone_types in line with them.
alter table public.stone_types enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'stone_types'
      and policyname = 'authenticated_read_all'
  ) then
    create policy authenticated_read_all
      on public.stone_types
      for select to authenticated
      using (true);
  end if;
end $$;

-- ── 2. vendor_advance_balance (a VIEW, not a table) ─────────────────
-- `alter table ... enable row level security` does not work on a view, which
-- is exactly why this one slipped through. A view runs with its OWNER's
-- rights by default, so it happily served rows out of vendor_advances even
-- though that underlying table has RLS switched on.
--
-- security_invoker makes the view execute as the *caller*, so the underlying
-- table's RLS finally applies: anon gets nothing, while the app keeps working
-- because every read of this view goes through the service-role admin client
-- (accounts/page.tsx, accounts/vendors/[id], accounts/bills/[id]), and service
-- role bypasses RLS.
alter view public.vendor_advance_balance set (security_invoker = on);

notify pgrst, 'reload schema';

-- ──────────────────────────────────────────────────────────────────
-- Verification (run separately):
--
--   select relname, relrowsecurity
--   from pg_class
--   where relnamespace = 'public'::regnamespace and relname = 'stone_types';
--   -- expect true
--
--   select relname
--   from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r'
--     and not relrowsecurity
--   order by relname;
--   -- expect zero rows
--
-- Then tell Claude to re-run the anonymous sweep for external proof.
-- ──────────────────────────────────────────────────────────────────
