-- Migration 070 — Vendor-to-vendor transfer attribution.
--
-- Daksh, May 2026 — when a CNC vendor uses Problem/transfer to hand
-- a slab to another vendor, the receiving vendor's cockpit had no
-- visual signal that the slab was an inter-vendor handoff. It just
-- appeared in Pending stock identical to a fresh-from-yard slab,
-- the runner-delivered ones. Two consequences:
--   1. The receiving vendor didn't know which vendor sent it — no
--      context for the transfer.
--   2. The slab transfer runner is the only role that can mark a
--      slab as received-at-vendor for the regular yard→shade path.
--      For vendor→vendor transfers the runner isn't necessarily
--      involved (the originating vendor may walk it across), so
--      Pending stock filled up indefinitely with rows nobody could
--      progress.
--
-- This migration adds four columns to track inter-vendor transfer
-- attribution + cleared / repopulated as the slab moves between
-- vendors. The UI shows a "Transferred from X" badge on Pending
-- stock rows when the columns are populated, plus Accept (vendor
-- self-receives) + Flag issue (vendor refuses, slab returns to
-- source) buttons.

BEGIN;

ALTER TABLE public.carving_items
  -- Snapshot of the originating vendor at transfer time. NULL when
  -- the slab arrived via the normal carving-assigner flow (i.e. not
  -- from another vendor).
  ADD COLUMN IF NOT EXISTS transferred_from_vendor_id UUID NULL
    REFERENCES public.vendors(id) ON DELETE SET NULL,
  -- Snapshot the vendor name too so the receiving cockpit can render
  -- "Transferred from Vivek" even if Vivek's vendor row is later
  -- archived. Same convention as carving_items.vendor_name.
  ADD COLUMN IF NOT EXISTS transferred_from_vendor_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS transferred_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.carving_items.transferred_from_vendor_id IS
  'Originating vendor when this slab was handed off via Problem/Transfer. NULL for the regular carving-assigner flow. Cleared when the receiving vendor accepts (mark received).';
COMMENT ON COLUMN public.carving_items.transferred_from_vendor_name IS
  'Snapshot of transferred_from_vendor_id.name at transfer time so the badge keeps reading even if the originating vendor row is later archived.';
COMMENT ON COLUMN public.carving_items.transferred_at IS
  'When the Problem/Transfer fired. Drives the "Transferred Xm ago" caption in the receiving cockpit.';
COMMENT ON COLUMN public.carving_items.transferred_by IS
  'Who fired the Problem/Transfer — usually the source vendor.';

-- Partial index: rows currently sitting in the receiving vendor's
-- pending tray awaiting accept/flag. Tiny but bumps the cockpit
-- query off a full scan.
CREATE INDEX IF NOT EXISTS carving_items_transfer_pending_idx
  ON public.carving_items (vendor_id, transferred_at DESC)
  WHERE transferred_from_vendor_id IS NOT NULL
    AND received_at_vendor_at IS NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
