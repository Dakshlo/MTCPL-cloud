-- ──────────────────────────────────────────────────────────────────
-- Migration 223: Royalty wipe — purge after the undo window closes
-- ──────────────────────────────────────────────────────────────────
-- Mig 222 shipped "clear all" as a permanent hide: rows stamped with a
-- batch id, filtered out of every read, recoverable by the developer
-- for 48h, and then kept hidden forever. Its header says outright
-- "there is deliberately no purge job".
--
-- Daksh has since revised that: once the developer can no longer bring
-- a cleared ledger back, the rows should be deleted for real rather
-- than sit hidden indefinitely. That is the ordinary trash-can
-- lifecycle — hide, undo window, purge — and it is his data and his
-- retention call to make. This migration records the reversal so the
-- 222 comment is not left standing as the current policy.
--
-- No schema change: DELETE needs no new column. What changes is code
-- (purgeExpiredRoyaltyWipes in accounts/actions.ts, swept lazily on
-- every read of a vendor's ledger and nightly by
-- /api/royalty-purge/run) and the column comments below.
--
-- What SURVIVES the purge, deliberately: the audit_logs row written
-- when the ledger was cleared, carrying the vendor, the actor, the
-- entry count and the cleared net balance — plus a second row when the
-- purge runs. The values go; the fact that a clear happened, who did
-- it and what it was worth stays on the record. That costs nothing
-- against the intent of the feature and is what keeps it defensible.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

COMMENT ON COLUMN public.vendor_royalty_entries.wiped_at IS
  'Mig 222/223 — set when a "clear all" hid this entry. Hidden from every read immediately, restorable by the developer for 48h, then hard-deleted by purgeExpiredRoyaltyWipes (lazily on read + nightly cron). The audit_logs lines for the wipe and the purge outlive the row.';

COMMENT ON COLUMN public.vendor_royalty_entries.wipe_batch_id IS
  'Mig 222/223 — groups the entries hidden by one "clear all" press, so recovery restores exactly that round and the purge deletes exactly that round.';

NOTIFY pgrst, 'reload schema';

COMMIT;
