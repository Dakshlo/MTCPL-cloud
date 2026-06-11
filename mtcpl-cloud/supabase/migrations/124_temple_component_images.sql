-- ──────────────────────────────────────────────────────────────────
-- 124 — Temple component reference images (Daksh, June 2026)
--
-- Attach a reference photo to a temple component node:
--   temple → section (Category 1) → element (Category 2, optional).
-- Shown as a thumbnail on the matching node in Temple View so it's easy
-- to see what each component looks like.
--
-- Public storage bucket (these are reference photos, low sensitivity —
-- same pattern as machine_images). The table reads go through the
-- service-role admin client; RLS is on with no policies.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.temple_component_images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  temple       TEXT NOT NULL,
  section      TEXT NOT NULL,          -- Category 1
  element      TEXT NULL,              -- Category 2 (NULL = attaches at the Category-1 node)
  label        TEXT NULL,
  image_path   TEXT NOT NULL,
  caption      TEXT NULL,
  uploaded_by  UUID NULL REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS temple_component_images_temple_idx
  ON public.temple_component_images (temple);

ALTER TABLE public.temple_component_images ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('temple_component_images', 'temple_component_images', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.temple_component_images;
--   DELETE FROM storage.buckets WHERE id = 'temple_component_images';
