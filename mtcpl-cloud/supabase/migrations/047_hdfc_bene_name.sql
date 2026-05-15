-- ──────────────────────────────────────────────────────────────────
-- Migration 047: bill_vendors — HDFC beneficiary-name field
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- HDFC's bulk NEFT/RTGS upload format ("RBI File Format - NEFT RTGS")
-- requires the Beneficiary Name in the file to EXACTLY MATCH the
-- name HDFC has registered for that vendor on their portal —
-- otherwise the row is rejected.
--
-- Our bill_vendors.name is what MTCPL refers to the vendor as
-- internally (e.g. "Paresh Kumar Enterprises Pvt Ltd"). HDFC may
-- have the same vendor stored under a different name (e.g.
-- "PARESH KMR ENT" — 20-char limit on their side, all caps, no
-- special chars). Without a place to store HDFC's exact label, the
-- export would either truncate badly or rename the vendor mid-file.
--
-- This migration adds a single column:
--   bill_vendors.hdfc_bene_name TEXT NULL
--
-- It's nullable so existing vendors stay valid. The HDFC export
-- pre-flight check will refuse to generate a row for any vendor
-- whose hdfc_bene_name is still NULL — and link the user back to
-- the vendor form to fill it in.
--
-- Constraints:
--   • Max 20 characters (HDFC's hard limit on column E).
--   • Stored as-is — the export step uppercases + strips special
--     chars at file-gen time, leaving the source value editable.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bill_vendors
  ADD COLUMN IF NOT EXISTS hdfc_bene_name TEXT NULL
    CHECK (hdfc_bene_name IS NULL OR length(hdfc_bene_name) <= 20);

-- Partial index — speeds up the "which vendors are missing their
-- HDFC name" pre-flight query that the export endpoint runs.
CREATE INDEX IF NOT EXISTS bill_vendors_missing_hdfc_name_idx
  ON public.bill_vendors (id)
  WHERE hdfc_bene_name IS NULL AND is_active = TRUE;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration: nothing automatic. Daksh will edit each vendor in
-- /accounts/vendors and paste in HDFC's exact bene-name (max 20
-- chars). Until that's done, the HDFC export will list the vendor
-- as "needs HDFC name" in the pre-flight panel.
-- ──────────────────────────────────────────────────────────────────
