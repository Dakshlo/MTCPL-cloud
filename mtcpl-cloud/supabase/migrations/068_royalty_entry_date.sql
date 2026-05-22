-- Migration 068 — Royalty entry: explicit entry_date column.
--
-- Daksh (May 2026): people writing the date inside the description
-- field ("22/05/2026 PAID TO PINTU BHAI", "21/05/2026", etc.) tells
-- us the date matters and there's no first-class place to put it.
-- This migration adds an entry_date column so the modal can capture
-- it cleanly going forward.
--
-- Existing rows are left untouched (NULL entry_date). The UI
-- gracefully falls back to created_at::date for legacy rows so the
-- per-vendor history stays readable. Per Daksh: "dont change
-- anything on already added".

BEGIN;

ALTER TABLE public.vendor_royalty_entries
  ADD COLUMN IF NOT EXISTS entry_date DATE NULL;

COMMENT ON COLUMN public.vendor_royalty_entries.entry_date IS
  'Business date the royalty entry represents (when the money / points changed hands). '
  'Distinct from created_at which is the system insert timestamp. '
  'NULL on entries inserted before mig 068; UI shows created_at::date as a fallback. '
  'Going forward the modal supplies this so accountants don''t encode dates inside description.';

-- Indexing isn''t critical — queries already scope by bill_vendor_id
-- and at most a few hundred entries per vendor — so we skip an index
-- to keep writes cheap.

NOTIFY pgrst, 'reload schema';
COMMIT;
