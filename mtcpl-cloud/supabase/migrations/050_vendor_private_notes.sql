-- ──────────────────────────────────────────────────────────────────
-- Migration 050: Vendor private notes — password-gated text scratchpad
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh wants a hidden per-vendor notes pad for capturing informal
-- context (negotiation history, contact preferences, his own private
-- observations) that he doesn't want surfaced on the public vendor
-- profile.
--
-- Strict constraints:
--   • TEXT ONLY. No money / quantity / numeric tracking. This is a
--     scratchpad, not a parallel ledger.
--   • HIDDEN. Accessed via a small low-visibility button on the
--     vendor profile, role-gated to developer/owner, with a
--     passphrase prompt before content is loaded.
--   • AUDITABLE. Every view / save / clear / passphrase-set lands
--     in audit_logs. Recoverable from Supabase backups. Non-negotiable.
--   • DECOUPLED. Lives on its own table; no FK or join touches the
--     financial flow.
--
-- Schema:
--   vendor_private_notes — 1:1 with bill_vendors (UNIQUE bill_vendor_id).
--   Holds a single text field per vendor, max 10000 chars.
--
-- Passphrase storage:
--   Reuses the existing system_settings k/v table (mig 031). Stores
--   { algo, salt, hash } under key='vendor_notes_password'. Hash is
--   computed by Node's built-in scrypt with a per-install salt.
--   Plain-text passphrase never persisted.
--
--   On first install, hash is NULL meaning "not set yet" — the UI
--   detects this and prompts the user to set a passphrase the first
--   time they open the notes panel.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Notes table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_private_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_vendor_id  UUID NOT NULL UNIQUE
                    REFERENCES public.bill_vendors(id) ON DELETE CASCADE,
  content         TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 10000),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- RLS on. No public SELECT policy — server-only reads via admin
-- client. Writes also via admin client + role-gated server action.
ALTER TABLE public.vendor_private_notes ENABLE ROW LEVEL SECURITY;

-- ── 2. Passphrase row in system_settings ─────────────────────────
-- Initial state: hash = null means "not set yet". The UI detects
-- this and forces the user to set a passphrase before they can save
-- or read any notes. Salt is pre-generated so a brute-force
-- attacker can't pick weaker parameters later.
INSERT INTO public.system_settings (key, value)
VALUES (
  'vendor_notes_password',
  jsonb_build_object(
    'algo', 'scrypt-32',
    'salt', encode(gen_random_bytes(16), 'hex'),
    'hash', NULL
  )
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. No data backfill. The notes table starts empty. Each vendor's
--    note row is created on first save.
-- 2. The 🔒 button appears on every vendor profile for developer +
--    owner roles only. Other roles never see it.
-- 3. First-use flow: open vendor profile → click 🔒 → modal prompts
--    to SET a passphrase (since hash=NULL). After set, hash is
--    populated and subsequent opens prompt to ENTER the passphrase.
-- 4. Changing the passphrase: developer-only UI block on /settings.
-- 5. Lost passphrase: ask a developer (Daksh) to run:
--      UPDATE public.system_settings
--         SET value = jsonb_set(value, '{hash}', 'null'::jsonb),
--             updated_at = NOW()
--       WHERE key = 'vendor_notes_password';
--    This resets to "not set yet" — next opener will be prompted
--    to set a fresh passphrase. Existing notes content is NOT
--    affected (still readable after passphrase re-set).
-- 6. Audit log actions emitted:
--      vendor_notes_passphrase_set
--      vendor_note_viewed
--      vendor_note_saved
--      vendor_note_cleared
-- ──────────────────────────────────────────────────────────────────
