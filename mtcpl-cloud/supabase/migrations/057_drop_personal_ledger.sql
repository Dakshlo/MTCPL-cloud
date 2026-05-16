-- ──────────────────────────────────────────────────────────────────
-- Migration 057: Drop Personal Ledger (rollback of mig 055 + 056)
-- ──────────────────────────────────────────────────────────────────
-- Daksh: the Personal Ledger module has been extracted into a
-- standalone app (its own Supabase project, its own Vercel
-- deployment). The data has been migrated over, so the in-MTCPL
-- copy is now redundant.
--
-- This migration:
--   • Drops all four personal_ledger_* tables.
--   • Drops in reverse-FK order so foreign-key constraints don't
--     block (receipts → invoices → buckets → parties).
--   • CASCADE handles the RLS policies + indexes attached to each
--     table.
--   • NOT idempotent in the strict sense — if the tables don't
--     exist this is a no-op (IF EXISTS).
--
-- After this runs:
--   • The mig 055 + 056 schema is fully reversed.
--   • Audit-log rows from the personal_ledger_* actions stay in
--     `audit_logs` — that history is intentionally kept (auditing
--     is forever-write, never deleted, even when the feature
--     it tracked is gone).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

DROP TABLE IF EXISTS public.personal_ledger_receipts CASCADE;
DROP TABLE IF EXISTS public.personal_ledger_invoices CASCADE;
DROP TABLE IF EXISTS public.personal_ledger_buckets  CASCADE;
DROP TABLE IF EXISTS public.personal_ledger_parties  CASCADE;

NOTIFY pgrst, 'reload schema';

COMMIT;
