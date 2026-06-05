-- Migration 092 — carving vendor type: 'Outsource' replaces 'Manual'
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- The two carving vendor types are now CNC and Outsource / Jobwork.
-- The old non-CNC type 'Manual' is dropped from the app entirely and
-- replaced by 'Outsource' (same behaviour — no tracked machines, the
-- head marks work started/done on the vendor's behalf — just renamed).
--
-- This adds 'Outsource' to the vendor_type enum so the new type can be
-- saved. ('Manual', if it was ever added to this DB by mig 091, simply
-- becomes unused — Postgres can't drop an enum value, but nothing in
-- the app writes or reads it anymore.)
--
-- SAFETY: idempotent (ADD VALUE IF NOT EXISTS). Adds one allowed enum
-- value; mutates no row, drops nothing. Confirmed with Daksh there are
-- no existing 'Manual' vendors, so no data conversion is needed.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block, so this migration has NO BEGIN/COMMIT. Run it as a single
-- statement in the Supabase SQL editor.

ALTER TYPE public.vendor_type ADD VALUE IF NOT EXISTS 'Outsource';

-- (No data conversion: no 'Manual' vendors exist. If any ever did,
--  run separately AFTER the above commits:
--    UPDATE public.vendors SET vendor_type = 'Outsource'
--    WHERE vendor_type = 'Manual';
--  — it must be a separate statement because a freshly-added enum
--  value can't be used in the same transaction that added it.)
