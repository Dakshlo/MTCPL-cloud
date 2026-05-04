-- 017: track each user's currently-viewed page on their heartbeat
-- ping. Powers the developer-only "Live Users" card on /settings —
-- shows a real-time peek of who is on which page right now.
--
-- Single nullable text column on profiles. The heartbeat ping
-- (every 2 minutes from /components/heartbeat.tsx) overwrites it
-- with the user's current pathname. NULL = pre-rollout (no ping
-- has fired with a path yet). Bound to a tiny check so a runaway
-- client can't shove 100KB of garbage into the column.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_path TEXT NULL
    CHECK (last_path IS NULL OR length(last_path) <= 200);

COMMIT;
