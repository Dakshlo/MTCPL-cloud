-- Migration 104 — Tender Manager app_role (Daksh, June 2026)
--
-- New role 'tender_manager' — owns the Register department (Activity
-- Register): create sites + log and manage activity entries. All access is
-- granted in code (departments + the activity-register gates); this
-- migration only adds the enum value.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` CANNOT run inside a transaction block,
-- so there is intentionally NO BEGIN/COMMIT here — run the statement as-is.
-- Idempotent (IF NOT EXISTS). Safe: enum addition only, no table/data change.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tender_manager';

NOTIFY pgrst, 'reload schema';
