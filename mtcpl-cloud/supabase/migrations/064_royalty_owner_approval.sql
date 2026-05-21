-- ──────────────────────────────────────────────────────────────────
-- Migration 064: Royalty entries — owner approval gate
-- ──────────────────────────────────────────────────────────────────
-- Mig 051 created vendor_royalty_entries with a flat "everyone with
-- private-notes access can add" model. Daksh: too loose. Accountant
-- / accountant_star / crosscheck still add the entry, but it lands
-- in a "pending_approval" state and only counts toward the net
-- balance after the owner (or developer) approves it from a new
-- Tasks-pill queue gated by an extra passphrase (125500).
--
-- Reject = soft-cancel with a specific reason so the audit trail
-- shows "owner rejected" instead of an ordinary cancel.
--
-- Owner / developer adds auto-approve (no queue round-trip — they're
-- the approvers, so requiring self-approval would be theatre).
--
-- Backfill: every pre-mig-064 row gets status='approved' with
-- approved_at = created_at, approved_by = created_by. Nothing
-- in production is currently in flight, but the backfill keeps the
-- net-balance math identical on day one.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.vendor_royalty_entries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rejected_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill: existing rows stay approved (with approved_at = created_at,
-- approved_by = created_by as best-effort attribution). Without this,
-- the get-entries action would skip them all from the net total
-- after the new "only approved counts" filter goes live.
UPDATE public.vendor_royalty_entries
   SET status = 'approved',
       approved_at = COALESCE(approved_at, created_at),
       approved_by = COALESCE(approved_by, created_by)
 WHERE status = 'approved'
   AND approved_at IS NULL;

-- Index for the Tasks-pill count + the approvals queue page.
-- Live (non-cancelled) pending entries, newest first.
CREATE INDEX IF NOT EXISTS vendor_royalty_entries_pending_idx
  ON public.vendor_royalty_entries (created_at DESC)
  WHERE status = 'pending_approval' AND cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
