-- ──────────────────────────────────────────────────────────────────
-- Migration 046: Profiles — login location (informational)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh wants to know whether a logged-in user is at the factory or
-- somewhere else (e.g. accessing the system from home). Today the
-- only signal is heartbeat last_seen_at — no geographic context.
--
-- Strict guarantees:
--   1. PURELY INFORMATIONAL. Auth + every business action
--      continue to work even if location capture fails entirely.
--   2. NON-BLOCKING. Fire-and-forget update from a client probe;
--      no UI waits on it.
--   3. PRIVACY-FRIENDLY. Browser asks the user for GPS permission
--      (standard prompt). If denied, we still capture IP-level
--      geo via Vercel's request headers — which is unavoidable
--      (every request sees the client IP anyway).
--
-- Two layers of fidelity:
--   IP-level geo (always available on Vercel):
--     - last_login_ip                (TEXT)
--     - last_login_country           (TEXT, ISO-2)
--     - last_login_region            (TEXT, state/region)
--     - last_login_city              (TEXT, city)
--     - last_login_ip_lat            (NUMERIC, city centre)
--     - last_login_ip_lng            (NUMERIC, city centre)
--     Resolution: ~5-50km. Tells you "Hyderabad" vs "Bangalore",
--     not "factory" vs "home".
--
--   GPS-level (browser permission required):
--     - last_login_gps_lat           (NUMERIC, exact coordinates)
--     - last_login_gps_lng           (NUMERIC)
--     - last_login_gps_accuracy_m    (INTEGER, ±meters)
--     - last_login_gps_status        (TEXT — see below)
--     Resolution: 10-100m. Tells you "at factory" vs "at home".
--
-- gps_status values (free-text — kept loose for v1 flexibility):
--   'granted'      — user allowed; coordinates captured
--   'denied'       — user refused permission
--   'unavailable'  — device has no GPS / position lookup failed
--   'timeout'      — geolocation API didn't return in time
--   'unknown'      — initial state (no probe has run yet)
--
-- Plus user_agent for forensic debugging ("which browser was used").
--
-- Approach
-- ────────
-- All columns are NULLable + default NULL. Existing profile rows are
-- unaffected. The new `last_login_at` is what the UI uses to decide
-- whether the captured location is fresh or stale.
--
-- The IP geo columns are populated server-side from Vercel's
-- request headers (x-vercel-ip-*). No external API dependency.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. New columns ───────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at            TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_login_ip            TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_login_country       TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_login_region        TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_login_city          TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_login_ip_lat        NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS last_login_ip_lng        NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS last_login_gps_lat       NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS last_login_gps_lng       NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS last_login_gps_accuracy_m INTEGER NULL,
  ADD COLUMN IF NOT EXISTS last_login_gps_status    TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_login_user_agent    TEXT NULL;

-- ── 2. Sanity index for the admin view ───────────────────────────
-- Partial index over rows that have an actual login captured. Keeps
-- the index tiny + cheap to maintain; doesn't index the millions of
-- NULL rows that exist before the feature ships.
CREATE INDEX IF NOT EXISTS profiles_last_login_at_idx
  ON public.profiles (last_login_at DESC)
  WHERE last_login_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. No backfill. last_login_at stays NULL until a user signs in and
--    the LoginLocationProbe client fires its first ping.
--
-- 2. RLS: profiles already restricts non-self reads to the admin
--    client — the same gate applies to these new columns. Devs +
--    owners see everyone via createAdminSupabaseClient(); other
--    roles only see their own row.
--
-- 3. The probe runs once per browser session (sessionStorage flag).
--    No spam, no continuous tracking. Locations refresh only on a
--    fresh login or a new tab.
--
-- 4. To wipe a user's location (e.g. if they ask):
--      UPDATE public.profiles SET
--        last_login_at = NULL, last_login_ip = NULL,
--        last_login_country = NULL, last_login_region = NULL,
--        last_login_city = NULL, last_login_ip_lat = NULL,
--        last_login_ip_lng = NULL, last_login_gps_lat = NULL,
--        last_login_gps_lng = NULL, last_login_gps_accuracy_m = NULL,
--        last_login_gps_status = NULL, last_login_user_agent = NULL
--      WHERE id = '<uuid>';
-- ──────────────────────────────────────────────────────────────────
