-- 113_idle_logout_minutes.sql
-- Per-user idle auto-logout timeout (developer-set, June 2026).
--
-- The idle auto-logout (mig-less client feature) signs a user out after
-- 10 minutes of inactivity. Some users want a longer window or none at
-- all, while critical roles (owner, accounts) should keep the short 10
-- minute timeout. This column lets the developer tune it per user:
--
--   NULL  → use the default (10 minutes).
--   0     → never auto-logout for this user (disabled).
--   N > 0 → log out after N minutes of inactivity.
--
-- Additive + idempotent. No data change to any existing row (default NULL
-- = the current 10-minute behaviour, so nothing changes until a developer
-- sets a value). Developer accounts are exempt from idle-logout entirely
-- in the app layer regardless of this value.
--
-- Rollback: ALTER TABLE profiles DROP COLUMN IF EXISTS idle_logout_minutes;

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS idle_logout_minutes INTEGER NULL;

-- Keep PostgREST's cached schema in sync so the new column is queryable
-- immediately without a manual reload.
NOTIFY pgrst, 'reload schema';

COMMIT;
