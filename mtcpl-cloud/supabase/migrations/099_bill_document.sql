-- ──────────────────────────────────────────────────────────────────
-- Migration 099: Scanned bill documents (photo / PDF)
--
-- Attach a scan/photo of the supplier's bill when creating it, and view
-- it on the bill detail page. The file lives in a PRIVATE Storage bucket
-- (bill_documents); the bills row stores the object path + mime. Reads use
-- short-lived signed URLs minted server-side via the service-role admin
-- client (same pattern as carving review photos), so the bucket needs no
-- public policy.
--
-- Additive + safe: ADD COLUMN IF NOT EXISTS only. Existing bills get NULL
-- (shown as "no document attached"). No existing data is touched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS document_path        TEXT,
  ADD COLUMN IF NOT EXISTS document_mime        TEXT,
  ADD COLUMN IF NOT EXISTS document_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS document_uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Private Storage bucket for the scans. Idempotent. The app reads/writes
-- through the service-role admin client (bypasses RLS), so no
-- storage.objects policies are required for it to work.
INSERT INTO storage.buckets (id, name, public)
VALUES ('bill_documents', 'bill_documents', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
