-- ──────────────────────────────────────────────────────────────────
-- 121 — email_messages (deduplicated archive)
--
-- Every important email the AI surfaces is stored here, ONE row per
-- unique email (dedup_key = the email's Message-ID, or a fallback hash).
-- Re-scanning overlapping windows (e.g. 7 days, then 1 month) upserts on
-- dedup_key, so the same email is never duplicated. Powers the "Open all
-- emails" Gmail-style archive on the dashboard, newest-to-oldest.
--
-- Privacy: RLS enabled with NO policies → only the service-role admin
-- client can read it. Only AI SUMMARIES are stored — never full emails
-- (those are fetched live & read-only on demand).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key       TEXT NOT NULL UNIQUE,
  uid             INTEGER NULL,            -- latest Gmail UID, to open the full email
  from_name       TEXT NULL,
  subject         TEXT NULL,
  summary         TEXT NULL,
  category        TEXT NULL,
  urgency         TEXT NULL,
  email_date      TIMESTAMPTZ NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_messages_date_idx
  ON public.email_messages (email_date DESC NULLS LAST);

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Tell PostgREST to pick up the new table.
NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP TABLE IF EXISTS public.email_messages;
