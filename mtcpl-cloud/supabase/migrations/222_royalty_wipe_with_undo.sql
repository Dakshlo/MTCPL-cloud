-- ──────────────────────────────────────────────────────────────────
-- Migration 222: Royalty points — "clear all" with a 48-hour undo
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh (Aug 2026), for himself + his dad (owner): one button on a
-- vendor's Royalty Points tab that clears the whole ledger — received
-- and paid alike — so the net balance reads 0 and the lists read
-- empty. Two confirmations before it fires. For 48 hours afterwards
-- the DEVELOPER (only) sees a recover button that puts every entry
-- back exactly as it was; during that window the owner's view shows
-- nothing at all for that vendor.
--
-- What this is NOT
-- ────────────────
-- Not a hard delete. Mig 051 negotiated this table's ground rules and
-- one of them was explicit: "Soft-cancel only — no hard delete.
-- Earlier 'wipe without trace' framing was declined; this is the
-- legitimate version." That still holds. A wipe stamps the rows and
-- hides them; the rows themselves are never removed, and both the
-- wipe and any recovery write to audit_logs with the vendor, the
-- actor, the entry count and the net balance that was cleared.
--
-- After the 48h window closes the rows STAY in place, still stamped,
-- still hidden — the button to bring them back is simply gone. There
-- is deliberately no purge job: nothing in this design ever destroys
-- a value that once existed. Recovery past the window is a developer
-- + SQL job, which is the correct amount of friction for it.
--
-- Why a batch id rather than a flag
-- ─────────────────────────────────
-- Wipe twice on the same vendor (clear, add more, clear again) and a
-- bare flag would recover BOTH rounds together. The batch id keeps
-- each wipe its own unit, so recovery restores exactly the round that
-- was undone and leaves earlier ones alone.
--
-- Rollback:
--   ALTER TABLE public.vendor_royalty_entries
--     DROP COLUMN IF EXISTS wiped_at,
--     DROP COLUMN IF EXISTS wiped_by,
--     DROP COLUMN IF EXISTS wipe_batch_id;
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.vendor_royalty_entries
  ADD COLUMN IF NOT EXISTS wiped_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wiped_by      UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wipe_batch_id UUID NULL;

-- Every live-entry read filters on wiped_at IS NULL, so the partial
-- index from mig 051 needs its wiped counterpart to stay useful.
CREATE INDEX IF NOT EXISTS vendor_royalty_entries_vendor_unwiped_idx
  ON public.vendor_royalty_entries (bill_vendor_id, created_at DESC)
  WHERE wiped_at IS NULL;

-- Drives the "is there something to recover for this vendor?" lookup
-- and the recover-by-batch update.
CREATE INDEX IF NOT EXISTS vendor_royalty_entries_wipe_batch_idx
  ON public.vendor_royalty_entries (bill_vendor_id, wipe_batch_id, wiped_at)
  WHERE wiped_at IS NOT NULL;

-- A stamped row must carry its batch, and an unstamped row must carry
-- neither — so "wiped" can never mean two different things.
ALTER TABLE public.vendor_royalty_entries
  DROP CONSTRAINT IF EXISTS vendor_royalty_entries_wipe_coherent;
ALTER TABLE public.vendor_royalty_entries
  ADD CONSTRAINT vendor_royalty_entries_wipe_coherent
    CHECK (
      (wiped_at IS NULL     AND wipe_batch_id IS NULL)
      OR
      (wiped_at IS NOT NULL AND wipe_batch_id IS NOT NULL)
    );

COMMENT ON COLUMN public.vendor_royalty_entries.wiped_at IS
  'Mig 222 — set when a "clear all" hid this entry. NOT a delete: the row stays, and the developer can restore its batch for 48h. Every live read filters wiped_at IS NULL.';
COMMENT ON COLUMN public.vendor_royalty_entries.wipe_batch_id IS
  'Mig 222 — groups the entries hidden by one "clear all" press, so recovery restores exactly that round and not an earlier one.';

NOTIFY pgrst, 'reload schema';

COMMIT;
