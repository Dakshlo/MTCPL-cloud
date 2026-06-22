-- ──────────────────────────────────────────────────────────────────
-- 153 — Daily market-news stance (Daksh, June 2026)
--
-- Adds the owner's headline verdict for the day (bull / bear / neutral)
-- + a one-line reason in both languages, shown big on the new Today's
-- News page. Purely additive.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.daily_news ADD COLUMN IF NOT EXISTS stance         TEXT NULL;
ALTER TABLE public.daily_news ADD COLUMN IF NOT EXISTS stance_note_en TEXT NULL;
ALTER TABLE public.daily_news ADD COLUMN IF NOT EXISTS stance_note_hi TEXT NULL;

NOTIFY pgrst, 'reload schema';
