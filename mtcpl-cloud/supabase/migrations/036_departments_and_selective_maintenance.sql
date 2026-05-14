-- ──────────────────────────────────────────────────────────────────────
-- Migration 036 — Departments + per-department selective maintenance
-- ──────────────────────────────────────────────────────────────────────
-- Splits the app into three operational departments — Production
-- (the existing cutting/carving/dispatch flow), Finance (the accounts
-- module from migration 028), and a stubbed Inventory module that
-- ships as a placeholder for v1. The split is deliberately UX-only
-- in v1: the routes stay flat (no /production/* prefix), but the
-- sidebar filters its entries by the user's current "active
-- department," and per-department maintenance flags let a developer
-- take ONE department offline without affecting the other two.
--
-- Two changes here:
--
--   1. profiles.active_department TEXT — which department the user
--      is currently "in." Only matters for developer + owner who can
--      see all three; everyone else's role implicitly locks them to
--      one (biller/accountant → Finance, cutting/carving roles →
--      Production). Defaults to 'production' so existing accounts
--      land where they already work.
--
--   2. system_settings gets three additional rows — production_status,
--      finance_status, inventory_status — each carrying the same
--      {down, message} JSONB shape the legacy 'system_status' row
--      uses. The original 'system_status' is preserved as a global
--      kill-switch (kept for safety / rollback), but the layout
--      checks per-department keys first. If a dept-specific key is
--      missing the lookup falls through to the global key.
--
-- RLS: system_settings rows already have an authenticated-read
-- policy and developer-only writes via server action. No new policy
-- needed.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Department preference on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_department TEXT NOT NULL DEFAULT 'production'
    CHECK (active_department IN ('production', 'finance', 'inventory'));

-- 2. Seed per-department maintenance rows. ON CONFLICT DO NOTHING so
-- re-running the migration is safe and we don't clobber any flag that
-- was already flipped manually.
INSERT INTO public.system_settings (key, value)
VALUES
  ('production_status', '{"down":false,"message":null}'::jsonb),
  ('finance_status',    '{"down":false,"message":null}'::jsonb),
  ('inventory_status',  '{"down":false,"message":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
