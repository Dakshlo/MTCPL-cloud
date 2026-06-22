-- ──────────────────────────────────────────────────────────────────
-- 156 — Daily stock / F&O ideas on the market brief (Daksh, June 2026)
--
-- The morning brief now also returns 3–5 actionable Indian stock / F&O
-- ideas (buy / sell / watch) with a conviction score (0–100) and a short
-- bilingual reason — stored alongside the news in the same daily_news row.
-- Ideas only, not advice (can be wrong); shown only to the developer + the
-- owner (Naresh). Purely additive.
--
-- picks shape: [{ symbol, name, segment ('equity'|'fno'), action
--   ('buy'|'sell'|'watch'), conviction (0-100), horizon, reason_en, reason_hi }]
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.daily_news
  ADD COLUMN IF NOT EXISTS picks JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
