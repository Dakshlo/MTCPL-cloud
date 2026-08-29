-- ──────────────────────────────────────────────────────────────────
-- Migration 224: per-user language for the email snapshot
-- ──────────────────────────────────────────────────────────────────
-- Daksh (Aug 2026): the dashboard's mail snapshot is written in
-- English. His dad reads Hindi more comfortably, so the card gets an
-- EN / हिं toggle — and the choice has to STICK, not reset on every
-- visit.
--
-- On profiles rather than localStorage because the ask was to remember
-- the person, not the browser: sign in from the office desktop or a
-- laptop and the snapshot should already be in the language you read.
-- Sits beside theme_preference, which is the same kind of setting.
--
-- NULL = never chosen, which renders English (what everyone sees
-- today). No backfill, so nothing changes for anyone until they touch
-- the toggle.
--
-- Rollback:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS snapshot_lang;
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS snapshot_lang TEXT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_snapshot_lang_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_snapshot_lang_check
    CHECK (snapshot_lang IS NULL OR snapshot_lang IN ('en', 'hi'));

COMMENT ON COLUMN public.profiles.snapshot_lang IS
  'Mig 224 — which language this person reads the dashboard email snapshot in. NULL = never chosen = English.';

NOTIFY pgrst, 'reload schema';

COMMIT;
