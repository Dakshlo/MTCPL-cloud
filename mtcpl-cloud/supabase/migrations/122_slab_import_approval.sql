-- ──────────────────────────────────────────────────────────────────
-- 122 — Slab import approval (Daksh, June 2026)
--
-- Required Sizes: the manual Add-Slab form is retired. The ONLY way to
-- add slab requirements is now Import from Excel, and every import is a
-- BATCH that needs approval (owner / senior_incharge / carving_head /
-- developer) before the slabs are actually created at status 'open'.
--
-- Each batch keeps the uploaded Excel file (audit copy, stored in the
-- slab_import_files bucket) plus the final reviewed rows as JSONB.
--
-- Privacy/RLS: enabled with NO policies — only the service-role admin
-- client reads/writes (same pattern as email_snapshots / activity_proofs).
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.slab_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  temple        TEXT NOT NULL,
  stone         TEXT NOT NULL,
  -- Final reviewed rows: [{label, description, length, width, height,
  -- quantity, quality, priority}] — inches, quantity expands at approval.
  rows          JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count     INTEGER NOT NULL DEFAULT 0,
  slab_count    INTEGER NOT NULL DEFAULT 0,
  file_path     TEXT NULL,         -- storage path of the uploaded Excel
  file_name     TEXT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by  UUID NULL REFERENCES public.profiles(id),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by   UUID NULL REFERENCES public.profiles(id),
  reviewed_at   TIMESTAMPTZ NULL,
  review_note   TEXT NULL,
  -- slab_requirements.batch_id written at approval (the deletable group).
  slab_batch_id UUID NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slab_import_batches_status_idx
  ON public.slab_import_batches (status, submitted_at DESC);

ALTER TABLE public.slab_import_batches ENABLE ROW LEVEL SECURITY;

-- Private bucket for the uploaded Excel audit copies. Idempotent. The app
-- reads/writes through the service-role admin client, so no storage
-- policies are required.
INSERT INTO storage.buckets (id, name, public)
VALUES ('slab_import_files', 'slab_import_files', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.slab_import_batches;
--   DELETE FROM storage.buckets WHERE id = 'slab_import_files';
