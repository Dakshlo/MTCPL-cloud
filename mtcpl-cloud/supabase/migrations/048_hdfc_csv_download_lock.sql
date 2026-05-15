-- ──────────────────────────────────────────────────────────────────
-- Migration 048: bill_payments — HDFC CSV download-lock
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh wants two separate buttons on Pay Today:
--   1. Preview Excel — for human verification, repeatable
--   2. Final CSV     — single-shot, locks each row so the
--                      accountant cannot accidentally download it
--                      twice and upload duplicate payments to HDFC
--
-- Without a lock, an accountant could:
--   a) Download CSV → upload to HDFC → close tab
--   b) Forget, refresh Pay Today, click Download again → re-upload
--   c) HDFC processes BOTH files → vendors get paid twice
--   d) Painful clawback workflow with the bank
--
-- Two new columns capture the lock state per bill_payment:
--   hdfc_csv_downloaded_at  TIMESTAMPTZ — when the CSV was made
--   hdfc_csv_downloaded_by  UUID        — who triggered it
--
-- A confirmed payment with hdfc_csv_downloaded_at IS NOT NULL is
-- considered "in flight at HDFC". It still shows on Pay Today (the
-- accountant still needs to mark it paid once HDFC processes the
-- file), but it's excluded from the next CSV download.
--
-- Excel preview ignores the lock entirely — it's a verification
-- tool, designed to be re-run as often as needed.
--
-- To un-lock a payment (e.g. HDFC rejected the file, redo from
-- scratch), a developer / owner runs:
--   UPDATE bill_payments
--      SET hdfc_csv_downloaded_at = NULL,
--          hdfc_csv_downloaded_by = NULL
--    WHERE id IN ('<uuid>', ...);

BEGIN;

ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS hdfc_csv_downloaded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS hdfc_csv_downloaded_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Partial index — narrows the "what's downloadable for HDFC right
-- now" query to confirmed-but-not-yet-downloaded rows. Tiny
-- maintenance cost (NULL rows aren't indexed), big read win.
CREATE INDEX IF NOT EXISTS bill_payments_hdfc_pending_idx
  ON public.bill_payments (proposed_batch_id, proposed_at DESC)
  WHERE status = 'confirmed' AND hdfc_csv_downloaded_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration: no backfill required. Existing confirmed payments
-- start with the columns NULL (= unlocked), so they're all eligible
-- for the next CSV download. Mark them as "already downloaded" via
-- a manual SQL if you want to exclude legacy rows from the file:
--
--   UPDATE public.bill_payments
--      SET hdfc_csv_downloaded_at = NOW(),
--          hdfc_csv_downloaded_by = NULL
--    WHERE status = 'confirmed' AND proposed_at < '<some date>';
-- ──────────────────────────────────────────────────────────────────
