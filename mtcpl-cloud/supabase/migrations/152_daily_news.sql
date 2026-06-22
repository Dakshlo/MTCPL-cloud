-- ──────────────────────────────────────────────────────────────────
-- 152 — Owner daily market-news brief (Daksh, June 2026)
--
-- One row per IST market day. Populated 8 AM weekdays by Claude Sonnet
-- 4.6 + web search (src/lib/market-news.ts), shown ONLY to the owner on
-- the dashboard. `items` is the bilingual digest (EN + HI). The token /
-- search counts + cost_usd power the "cost to generate" line.
--
-- Service-role only (RLS on, no policies) — same posture as app_settings
-- / email_snapshots; the dashboard reads it via the admin client.
-- ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_news (
  news_date     DATE PRIMARY KEY,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  model         TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  overview_en   TEXT NULL,
  overview_hi   TEXT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  web_searches  INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
  trigger       TEXT NULL,
  error         TEXT NULL
);

ALTER TABLE public.daily_news ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies)

CREATE INDEX IF NOT EXISTS daily_news_date_idx ON public.daily_news (news_date DESC);

NOTIFY pgrst, 'reload schema';
