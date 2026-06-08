-- Migration 111 — Maintenance: machine groups + photos (Daksh, June 2026)
--
-- Restructures the machine registry around GROUPS (e.g. "Cranes", "CNCs"):
-- create a group, then add machines into it. Each group carries a shared
-- photo; a machine can optionally override with its own photo (otherwise it
-- shows the group photo). Photos live in a PUBLIC bucket (catalog images,
-- not sensitive) so the cards can show them directly.
--
-- SAFETY: one new table + additive ADD COLUMN IF NOT EXISTS on
-- company_machines (all nullable) + a new public bucket. No other table
-- touched, no enum changes, no data conversion. Existing machines keep
-- working (group_id stays NULL → they show under "Ungrouped"). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.machine_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  image_path  TEXT NULL,                 -- shared group photo (in machine_images)
  image_mime  TEXT NULL,
  created_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_machines
  ADD COLUMN IF NOT EXISTS group_id   UUID NULL REFERENCES public.machine_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_path TEXT NULL,   -- machine's own photo (overrides group)
  ADD COLUMN IF NOT EXISTS image_mime TEXT NULL;

CREATE INDEX IF NOT EXISTS company_machines_group_idx ON public.company_machines (group_id);

-- Public bucket for group + machine catalog photos (so cards render the
-- image directly via the public URL). Writes still go through the
-- service-role admin client.
INSERT INTO storage.buckets (id, name, public)
VALUES ('machine_images', 'machine_images', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.machine_groups ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_groups' AND policyname='machine_groups_read') THEN
    CREATE POLICY machine_groups_read ON public.machine_groups FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.company_machines
--     DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS image_path, DROP COLUMN IF EXISTS image_mime;
--   DROP TABLE IF EXISTS public.machine_groups;
--   DELETE FROM storage.buckets WHERE id = 'machine_images';
