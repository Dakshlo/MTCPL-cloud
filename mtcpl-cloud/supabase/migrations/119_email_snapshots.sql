-- Migration 119 — Owner email snapshot (Daksh, June 2026)
--
-- Twice a day (5am + 2pm IST, Vercel cron) the system reads the owner's
-- Gmail inbox over IMAP (STRICTLY read-only — the code contains no SMTP,
-- it cannot send/delete/modify mail), has Claude pick out the important
-- emails and summarize what each one actually says, and stores the result
-- here. The dashboard shows the latest snapshot to owner/developer only.
--
-- PRIVACY: unlike other tables, NO read-all policy. RLS is enabled with
-- no policies, so PostgREST/anon clients can read nothing; only the
-- service-role admin client (server-side, role-gated to owner/dev on the
-- page) can touch it. Only AI summaries are stored — never full emails.
--
-- SAFETY: brand-new table only. No other table touched. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- [{from, subject, summary, category, urgency}] — important emails only.
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- One-line overview ("9 emails, 2 need action: ...").
  overview      TEXT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  -- 'cron' | 'manual'
  trigger       TEXT NOT NULL DEFAULT 'cron',
  error         TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_snapshots_generated_idx
  ON public.email_snapshots (generated_at DESC);

-- RLS on, deliberately NO policies → service-role only.
ALTER TABLE public.email_snapshots ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.email_snapshots;
