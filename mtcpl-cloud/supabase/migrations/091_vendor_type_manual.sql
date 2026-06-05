-- Migration 091 — ensure 'Manual' is a valid vendor_type (Daksh, June 2026)
--
-- WHAT / WHY
-- The app has long referenced two carving vendor types — 'CNC' and
-- 'Manual' (the Assign modal even has a dedicated "Manual Carvers"
-- section). But the live public.vendor_type enum was originally
-- created with only 'CNC', and 'Manual' was added to schema.sql + the
-- TypeScript types WITHOUT a matching migration. Result: creating a
-- Manual vendor errored at the DB ("invalid input value for enum
-- vendor_type: Manual"), the insert silently failed, and Manual
-- carvers never appeared in Manage Vendors or the Assign picker.
--
-- This adds 'Manual' to the enum so Manual vendors can be created,
-- listed, edited and assigned.
--
-- SAFETY: idempotent (ADD VALUE IF NOT EXISTS) — if the enum already
-- has 'Manual' on this database, it's a harmless no-op. It only ADDS
-- an allowed value; mutates no row, drops nothing.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block, so this migration intentionally has NO BEGIN/COMMIT. Run it
-- as a single statement in the Supabase SQL editor.

ALTER TYPE public.vendor_type ADD VALUE IF NOT EXISTS 'Manual';

-- ROLLBACK: Postgres cannot remove a value from an enum. To undo,
-- you would recreate the type without 'Manual' (only safe if no row
-- uses it). Not needed in normal operation.
