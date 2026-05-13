-- ──────────────────────────────────────────────────────────────────
-- Migration 029: Enable RLS on every public-schema table
--
-- Why
-- ───
-- Supabase's security advisor flags every public-schema table where
-- RLS is disabled (`rls_disabled_in_public`). The anon key, which
-- ships in every client bundle by design, has the default SELECT
-- grants on every table — so anyone with that key (which is
-- public-by-design) could query your data directly via PostgREST,
-- skipping your server actions entirely.
--
-- MTCPL Cloud has been operating safely because every WRITE goes
-- through the service-role admin client (bypasses RLS entirely), but
-- the READ side was wide open at the database level. This migration
-- closes that gap.
--
-- Approach
-- ────────
-- 1. Enable RLS on every table in the public schema (no-op if
--    already enabled).
-- 2. Add a `FOR SELECT TO authenticated USING (TRUE)` policy on each
--    so signed-in users (via the browser supabase client) can still
--    read tables that realtime + notification-bell subscribe to.
-- 3. No anon-read policies are added — the anon key can no longer
--    SELECT anything directly. Server-side reads keep working
--    because they use the admin client (bypasses RLS).
--
-- Audit trail of breakage candidates considered + cleared:
--   • Server actions → all use createAdminSupabaseClient(), bypass.
--   • /embed/* routes → server components using admin client, bypass.
--   • RealtimeRefresh component → authenticated session, covered.
--   • NotificationBell → routes through server actions, bypass.
--
-- Idempotent: skips tables whose `authenticated_read_all` policy
-- already exists. Any pre-existing per-table policies (e.g. the
-- `bill_vendors_read_authenticated` policy added in migration 028)
-- are left alone — they continue working alongside this one.
--
-- Important: any FUTURE migration that adds a public table must
-- include its own ENABLE ROW LEVEL SECURITY + read policy (as 028
-- does), OR this migration should be re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t.tablename
        AND policyname = 'authenticated_read_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY authenticated_read_all ON public.%I FOR SELECT TO authenticated USING (TRUE)',
        t.tablename
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- Every public table should now have rowsecurity=true:
--   SELECT tablename, rowsecurity
--     FROM pg_tables WHERE schemaname='public'
--    ORDER BY tablename;
--
--   -- Every table should have the new policy:
--   SELECT tablename, policyname
--     FROM pg_policies WHERE schemaname='public'
--    ORDER BY tablename, policyname;
--
-- After running, the Supabase Advisor warning
-- (rls_disabled_in_public) should clear within ~5 minutes.
-- ──────────────────────────────────────────────────────────────────
