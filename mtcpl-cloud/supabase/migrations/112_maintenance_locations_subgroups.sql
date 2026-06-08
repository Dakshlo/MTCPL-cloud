-- Migration 112 — Maintenance: fixed locations + nested groups (Daksh, June 2026)
--
-- Two additions to the Maintenance dept:
--   1) machine_locations — a creatable list of fixed locations (e.g.
--      "Shade 1", "Shade 2", "Yard") so machines pick a known spot
--      instead of free-typing every time. New values typed on the
--      machine form are remembered here automatically.
--   2) machine_groups.parent_id — lets a group nest under a parent group
--      (e.g. primary "CNC" → sub-group "Mohit CNC"). One level deep.
--
-- SAFETY: one new table + one nullable self-referencing column. No other
-- table touched, no enum changes, no data conversion. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.machine_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.machine_locations (name) VALUES
  ('Shade 1'), ('Shade 2'), ('Yard')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.machine_groups
  ADD COLUMN IF NOT EXISTS parent_id UUID NULL REFERENCES public.machine_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS machine_groups_parent_idx ON public.machine_groups (parent_id);

ALTER TABLE public.machine_locations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_locations' AND policyname='machine_locations_read') THEN
    CREATE POLICY machine_locations_read ON public.machine_locations FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.machine_groups DROP COLUMN IF EXISTS parent_id;
--   DROP TABLE IF EXISTS public.machine_locations;
