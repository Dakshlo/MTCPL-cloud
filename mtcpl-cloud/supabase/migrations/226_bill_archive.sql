-- ──────────────────────────────────────────────────────────────────
-- Migration 226: archive a fully-paid bill (owner, OTP-confirmed)
-- ──────────────────────────────────────────────────────────────────
-- Daksh (Sep 2026), for his dad: once a vendor bill is 100% settled —
-- whether by payment or by the ⚖ Settle route (mig 219) — the owner
-- wants it gone from the accounts: out of the lists, out of the vendor
-- totals, out of "total paid". Finished business should stop taking up
-- room.
--
-- NOTHING IS DELETED. This is a soft archive:
--
--   • archived_at / archived_by / archive_reason mark the row. Every
--     list and every total filters on `archived_at IS NULL`; the row
--     itself, its payments, its vouchers and its audit trail all stay
--     exactly where they were.
--   • The DEVELOPER (and only the developer) can list every archived
--     bill for any vendor and restore it, at any time, with no window
--     and no expiry. Restore is a single UPDATE back to NULL.
--
-- Why a soft archive and not a delete: bill_payments, vouchers and the
-- final-audit trail all reference these rows. A hard delete would
-- either fail on the foreign keys or silently orphan a paid voucher —
-- and a paid voucher that points at nothing is a hole in the books.
--
-- SAFETY PROPERTY WORTH RECORDING. Only a fully-paid bill can be
-- archived, and on 1 Sep 2026 all 850 fully_paid bills carried
-- amount_outstanding = 0 (checked, no exceptions). So archiving can
-- only ever remove a ZERO from an outstanding sum — no outstanding
-- figure anywhere in the app can move because of this feature. Only
-- the "total billed / total paid" style sums and the lists change,
-- which is exactly what was asked for. The CHECK constraint below
-- keeps that property true rather than leaving it as a convention.
--
-- Rollback:
--   ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_archive_only_when_settled;
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by,
--     DROP COLUMN IF EXISTS archive_reason;
--   DROP TABLE IF EXISTS public.action_otps;
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. the archive marks ──────────────────────────────────────────
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_by   UUID NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS archive_reason TEXT NULL;

COMMENT ON COLUMN public.bills.archived_at IS
  'Mig 226 — set when the owner archives a fully-paid bill. NULL = live. Hidden from every list and total; never deleted, developer can restore.';

-- The database, not just the server action, refuses to archive a bill
-- that still owes money or is holding some back. A held amount means
-- the company is deliberately withholding part of the payment — that
-- bill is not finished, whatever its status says.
ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_archive_only_when_settled;
ALTER TABLE public.bills
  ADD CONSTRAINT bills_archive_only_when_settled
    CHECK (
      archived_at IS NULL
      OR (status = 'fully_paid'
          AND COALESCE(amount_outstanding, 0) = 0
          AND COALESCE(held_amount, 0) = 0)
    );

-- Partial index: every list query in the app now carries
-- `archived_at IS NULL`, and archived rows are the rare case.
CREATE INDEX IF NOT EXISTS bills_archived_at_idx
  ON public.bills (archived_at)
  WHERE archived_at IS NOT NULL;

-- ── 2. one-time codes for a destructive in-app action ─────────────
-- The owner asked for an OTP rather than another "are you sure?" —
-- clicking through two confirmations is muscle memory, typing a code
-- that arrives on his phone is not. Same shape as the login OTP
-- (hashed at rest, attempt-capped) but entirely separate from it: this
-- never mints a session and cannot be replayed against the login.
CREATE TABLE IF NOT EXISTS public.action_otps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the code authorises. Bound to the exact row so a code issued
  -- for one bill can never archive a different one.
  action       TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  -- Who asked, and who the code was sent to.
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  sent_to      TEXT NOT NULL,
  -- sha256 of the code. The code itself is never stored.
  code_hash    TEXT NOT NULL,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_otps_lookup_idx
  ON public.action_otps (action, subject_id, consumed_at, expires_at);

-- Server-side only. RLS on with no policies at all: the service-role
-- key bypasses RLS, every other client is refused outright — the same
-- posture the salary tables use (mig 189).
ALTER TABLE public.action_otps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.action_otps IS
  'Mig 226 — one-time codes confirming destructive in-app actions (first use: archiving a fully-paid bill). Not login OTPs; these never create a session.';

NOTIFY pgrst, 'reload schema';

COMMIT;
