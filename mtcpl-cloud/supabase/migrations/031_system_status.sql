-- ──────────────────────────────────────────────────────────────────
-- Migration 031: System maintenance toggle
--
-- Why
-- ───
-- Adds a developer-only "take the system down for maintenance"
-- switch. When flipped on, every authenticated page under (app)
-- short-circuits to a full-screen maintenance screen. Non-developer
-- users see a clickable-nothing message; the developer sees the
-- same screen with a "bring back live" button so they're not locked
-- out.
--
-- Approach
-- ────────
-- A tiny key/value `system_settings` table. The only key we use today
-- is `system_status` with `value = {"down": true|false}`. Designed so
-- future global flags can piggyback on the same table without a
-- migration each time.
--
-- Safety
-- ──────
-- The layout reads this via getSystemStatus() which wraps the query
-- in try/catch — if this migration hasn't run yet (or the table is
-- ever dropped), the helper returns `down: false` and the app keeps
-- working normally. This makes the feature non-blocking — deploying
-- the code without running the migration is safe.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Seed the system_status row in the "live" state. The toggle action
-- updates this row in-place; we never insert again.
INSERT INTO public.system_settings (key, value)
VALUES ('system_status', '{"down": false, "message": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS — authenticated users can read so the layout helper works for
-- everyone. Writes go through the admin-client server action with a
-- developer-only role gate (no anon write path).
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "system_settings_read_authenticated"
    ON public.system_settings
    FOR SELECT TO authenticated USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
