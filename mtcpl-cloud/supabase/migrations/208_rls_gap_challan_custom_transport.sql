-- 208 — Close the RLS gap Supabase's advisor flagged (rls_disabled_in_public)
--
-- WHAT WAS ACTUALLY WRONG
-- ──────────────────────
-- Two public-schema tables had RLS disabled. The anon/publishable key ships
-- inside the client bundle by design, and the anon role holds the default
-- SELECT grant, so ANY person with the project URL could read them straight
-- off PostgREST — no login, bypassing every server action and role check.
--
-- Verified against production before writing this (anonymous key, read-only):
--     challan_custom_items    27 rows total   27 readable anonymously
--     transport_companies      2 rows total    2 readable anonymously
-- Every other table in the public schema returned 0 rows to anon while holding
-- real data, i.e. they were already protected.
--
-- WHY THESE TWO AND NOT THE OTHERS
-- ────────────────────────────────
-- Migration 029 enables RLS by looping over pg_tables, so it only ever covers
-- tables that exist at the moment it runs. These two were created afterwards
-- (169_invoice_transport, 177_drop_challan) and neither migration enabled RLS
-- for itself, so nothing ever switched it on.
--
-- WHY NO POLICIES
-- ───────────────
-- Both tables are exclusively server-side: every reference across the 13 files
-- that touch them goes through createAdminSupabaseClient() (service role), which
-- bypasses RLS. Nothing reads them from the browser and no realtime channel
-- subscribes to them, so RLS-on-with-no-policies breaks nothing — the same
-- shape used by the newer tables (189 salary, 207 parkota).
--
-- Deliberately NOT re-running 029's blanket loop: it also grants
-- `authenticated_read_all` (SELECT to every signed-in user) on every table it
-- touches, which is not something to hand to tables like personal_ledger_entries
-- or the salary tables by accident.

alter table challan_custom_items enable row level security;
alter table transport_companies  enable row level security;

notify pgrst, 'reload schema';

-- ──────────────────────────────────────────────────────────────────
-- Verification (run separately after applying; expect rowsecurity = true):
--
--   select relname, relrowsecurity
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in ('challan_custom_items','transport_companies');
--
-- And re-check the whole schema for any table still unprotected:
--
--   select relname
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relkind = 'r'
--     and not relrowsecurity
--   order by relname;
-- ──────────────────────────────────────────────────────────────────
