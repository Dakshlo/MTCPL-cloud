-- ──────────────────────────────────────────────────────────────────
-- Migration 025: slab transfer person role + dropoff plumbing
--
-- Phase 4 follow-up. Today the flow assumes the slab magically moves
-- from the cutter's drop location to the vendor's shade. Daksh
-- wants a dedicated transfer-person role that physically moves
-- slabs and marks them delivered. Schema bits:
--
--   1. vendors.dropoff_location  TEXT
--        Standard place to drop slabs for this vendor (e.g.
--        "Shade A, near gate"). Set on vendor edit form.
--
--   2. carving_items.dropoff_note  TEXT
--        Where the transfer person ACTUALLY left the slab
--        (optional — only filled when it's not at the standard
--        dropoff location).
--
--   3. carving_items.claimed_by  UUID + .claimed_at TIMESTAMPTZ
--        Claim lock so two transfer people don't both grab the
--        same slab. NULL = unclaimed, available. Set on Claim,
--        cleared on Deliver (or manual Unclaim).
--
--   4. app_role enum: add 'slab_transfer'
--        New role for the runners. Sees /carving/transfer.
--        Can't read anything else.
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction block, so we
-- do that step in its own statement outside BEGIN/COMMIT. Everything
-- else stays in a single transaction for atomicity.
-- ──────────────────────────────────────────────────────────────────

-- ── 1. Enum bump (must be outside any transaction) ──────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'slab_transfer';

-- ── 2. Vendor + carving_items columns + index ───────────────────
BEGIN;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS dropoff_location TEXT;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS dropoff_note TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Drives the /carving/transfer "unclaimed pending pickup" widget.
CREATE INDEX IF NOT EXISTS carving_items_unclaimed_transfer_idx
  ON public.carving_items (assigned_at)
  WHERE received_at_vendor_at IS NULL
    AND claimed_by IS NULL
    AND status = 'carving_assigned';

-- And the "claimed by me" widget.
CREATE INDEX IF NOT EXISTS carving_items_claimed_by_idx
  ON public.carving_items (claimed_by, claimed_at DESC)
  WHERE claimed_by IS NOT NULL AND received_at_vendor_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
