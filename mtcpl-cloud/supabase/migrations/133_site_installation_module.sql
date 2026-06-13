-- ──────────────────────────────────────────────────────────────────
-- 133 — Site / Installation module (Daksh, June 2026)
--
-- The stage AFTER dispatch: a delivered truck reaches the temple site.
-- The site incharge unloads it into a YARD, keeps stock, transfers
-- slabs between yards, then INSTALLS them (with a photo).
--
-- Site state is DERIVED from columns (no slab_status enum change — keeps
-- Temple View / every existing board byte-identical):
--   • to-unload : slab on a DELIVERED dispatch, site_yard_id IS NULL
--   • in-stock  : site_yard_id IS NOT NULL AND installed_at IS NULL
--   • installed : installed_at IS NOT NULL
-- status stays 'dispatched' throughout (already an exit from live boards).
--
-- PURELY ADDITIVE — one table, nullable columns, one bucket.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- Site yards — created on the fly by the incharge per temple.
CREATE TABLE IF NOT EXISTS public.site_yards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  temple TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One yard name per temple (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS site_yards_temple_name_idx
  ON public.site_yards (temple, lower(name));
ALTER TABLE public.site_yards ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

-- Per-slab site + installation state.
ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS site_yard_id UUID NULL REFERENCES public.site_yards(id),
  ADD COLUMN IF NOT EXISTS site_unloaded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS site_unloaded_by UUID NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS installed_by UUID NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS install_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS install_photo_path TEXT NULL;

CREATE INDEX IF NOT EXISTS slab_requirements_site_yard_idx
  ON public.slab_requirements (site_yard_id) WHERE site_yard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS slab_requirements_installed_idx
  ON public.slab_requirements (installed_at) WHERE installed_at IS NOT NULL;

-- Install proof photos (public bucket — same posture as dispatch proofs).
INSERT INTO storage.buckets (id, name, public)
VALUES ('site_install_photos', 'site_install_photos', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements
--     DROP COLUMN IF EXISTS site_yard_id, DROP COLUMN IF EXISTS site_unloaded_at,
--     DROP COLUMN IF EXISTS site_unloaded_by, DROP COLUMN IF EXISTS installed_at,
--     DROP COLUMN IF EXISTS installed_by, DROP COLUMN IF EXISTS install_note,
--     DROP COLUMN IF EXISTS install_photo_path;
--   DROP TABLE IF EXISTS public.site_yards;
--   DELETE FROM storage.buckets WHERE id = 'site_install_photos';
