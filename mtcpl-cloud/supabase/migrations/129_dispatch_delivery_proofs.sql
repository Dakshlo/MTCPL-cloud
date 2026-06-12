-- ──────────────────────────────────────────────────────────────────
-- 129 — Dispatch delivery proofs (Daksh, June 2026)
--
-- Marking a dispatch "Delivered" now REQUIRES two photos:
--   1. The truck at the site (proof the slabs reached), and
--   2. The signed delivery challan.
-- Both are uploaded at Mark-Delivered time and stored on the dispatch
-- row, shown as thumbnails in the Delivered tab + on the printed
-- challan archive.
--
-- Public bucket (same pattern as temple_component_images — low
-- sensitivity reference photos, simplest viewing).
--
-- PURELY ADDITIVE — two nullable columns + one bucket. Existing
-- delivered dispatches keep NULL (recorded before this rule).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS proof_site_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS proof_challan_path TEXT NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('dispatch_delivery_proofs', 'dispatch_delivery_proofs', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.dispatches
--     DROP COLUMN IF EXISTS proof_site_path,
--     DROP COLUMN IF EXISTS proof_challan_path;
--   DELETE FROM storage.buckets WHERE id = 'dispatch_delivery_proofs';
