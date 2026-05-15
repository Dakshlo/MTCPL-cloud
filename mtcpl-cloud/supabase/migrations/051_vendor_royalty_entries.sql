-- ──────────────────────────────────────────────────────────────────
-- Migration 051: Vendor royalty / point entries
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh: in addition to the text notes (mig 050), needs a per-vendor
-- running tally of "royalty points" — abstract numeric units, not
-- money. Used for tracking informal credits / allowances / quantity
-- units between MTCPL and the vendor that aren't formal bills.
--
-- Strict constraints (NEGOTIATED with Daksh after several iterations):
--   1. Units, NOT money. UI shows raw numbers with no currency
--      symbol, no decimal-padding, no thousand grouping that looks
--      like rupees.
--   2. AUDITABLE. Every add / cancel logs to audit_logs with the
--      value + vendor + actor. Soft-cancel only — no hard delete.
--      Earlier "wipe without trace" framing was declined; this is
--      the legitimate version.
--   3. RECOVERABLE. Supabase backups capture full row history,
--      including cancelled rows.
--   4. Password gated via the SAME passphrase as text notes
--      (system_settings.key='vendor_notes_password'). Two features,
--      one auth gate.
--
-- Schema notes
-- ────────────
-- One row per entry (not one row per vendor). Net balance computed
-- on the fly from sum of non-cancelled entries. Two entry types:
--   • 'received' — positive contribution to vendor balance (vendor
--     gave points to MTCPL)
--   • 'given'    — MTCPL gave points to vendor
-- Net = sum(received) − sum(given), shown as a single number.
-- Daksh's red/green colour cue applies at render time.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_royalty_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_vendor_id  UUID NOT NULL
                    REFERENCES public.bill_vendors(id) ON DELETE CASCADE,
  -- Positive numeric value. The entry_type below decides whether it
  -- counts as a +/− toward the net.
  amount          NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('received', 'given')),
  description     TEXT NULL CHECK (description IS NULL OR length(description) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Soft cancel — preserves audit trail of every value that ever
  -- existed. NO hard DELETE permitted from the UI.
  cancelled_at    TIMESTAMPTZ NULL,
  cancelled_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason   TEXT NULL CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 200)
);

-- Partial index — speeds up the "balance for this vendor" query
-- that sums non-cancelled entries.
CREATE INDEX IF NOT EXISTS vendor_royalty_entries_vendor_live_idx
  ON public.vendor_royalty_entries (bill_vendor_id, created_at DESC)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS vendor_royalty_entries_vendor_all_idx
  ON public.vendor_royalty_entries (bill_vendor_id, created_at DESC);

ALTER TABLE public.vendor_royalty_entries ENABLE ROW LEVEL SECURITY;
-- No public read policy — server-only reads via admin client.

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. Passphrase row already exists (mig 050). No new auth setup.
-- 2. To audit who's been entering royalty points and how much:
--      SELECT created_at, action,
--             (SELECT full_name FROM profiles WHERE id = user_id) AS who,
--             entity_id AS vendor_id,
--             details
--        FROM public.audit_logs
--       WHERE action LIKE 'vendor_royalty%'
--       ORDER BY created_at DESC;
-- 3. To get the live balance per vendor (across all non-cancelled
--    entries):
--      SELECT bv.name,
--             SUM(CASE WHEN re.entry_type='received' THEN re.amount ELSE 0 END)
--               - SUM(CASE WHEN re.entry_type='given'    THEN re.amount ELSE 0 END)
--             AS net_points
--        FROM public.vendor_royalty_entries re
--        JOIN public.bill_vendors bv ON bv.id = re.bill_vendor_id
--       WHERE re.cancelled_at IS NULL
--       GROUP BY bv.name
--       ORDER BY net_points DESC;
-- ──────────────────────────────────────────────────────────────────
