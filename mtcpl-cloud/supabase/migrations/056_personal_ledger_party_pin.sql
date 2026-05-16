-- ──────────────────────────────────────────────────────────────────
-- Migration 056: Per-party 4-digit PIN for Personal Ledger
-- ──────────────────────────────────────────────────────────────────
-- Daksh (Mig 055 follow-on):
--   "to enter any party card need password we can set password while
--    adding party. keep password 4 digit."
--
-- Adds an optional `entry_pin_hash` to personal_ledger_parties. NULL
-- means the party has no PIN (legacy rows from Mig 055 — the one
-- existing "BN" party in Daksh's data). The UI will prompt to set a
-- PIN the first time a no-PIN party is opened so every party ends
-- up locked after one round of clicks.
--
-- All new parties created from Mig 056 forward will have a PIN at
-- creation (UI-enforced; no NOT NULL constraint here because legacy
-- rows would break the migration).
--
-- The hash is scrypt-based (salt:hash format), produced server-side
-- by src/lib/personal-ledger-party-auth.ts. No plaintext PIN ever
-- hits the database. RLS already isolates rows to the owner, so the
-- hash isn't visible to other users even via PostgREST.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.personal_ledger_parties
  ADD COLUMN IF NOT EXISTS entry_pin_hash TEXT NULL
    CHECK (entry_pin_hash IS NULL OR length(entry_pin_hash) BETWEEN 16 AND 256);

NOTIFY pgrst, 'reload schema';

COMMIT;
