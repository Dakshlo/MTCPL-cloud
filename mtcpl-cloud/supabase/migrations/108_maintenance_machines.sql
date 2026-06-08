-- Migration 108 — Maintenance department: company machine registry (Daksh, June 2026)
--
-- A brand-new department that keeps track of every company machine / vehicle
-- (gantry crane, cranes, CNCs, cutters, wire saw, pickups, trucks, etc.) and
-- its working status. Separate from the CNC carving cockpit table
-- `cnc_machines` — this is the company-wide asset registry.
--
-- This migration adds the registry + two small creatable lookup lists +
-- a private storage bucket for maintenance-ticket photos (used by mig 109).
--
-- SAFETY: brand-new tables + a new storage bucket only. No other table
-- touched, no enum changes, no data conversion. Idempotent.

BEGIN;

-- ── Creatable lookup lists ──────────────────────────────────────────
-- Machine TYPE (crane / CNC / truck …) and owning SECTION (Cutting /
-- Logistics …). Stored as plain text on the machine; these tables just
-- back the pickers so new values reappear next time.
CREATE TABLE IF NOT EXISTS public.machine_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.machine_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.machine_categories (name) VALUES
  ('Gantry Crane'), ('Crane'), ('CNC'), ('Cutter'), ('Wire Saw'),
  ('Pickup'), ('Truck'), ('Generator'), ('Other')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.machine_sections (name) VALUES
  ('Cutting'), ('Carving'), ('Workshop'), ('Logistics'), ('Yard'), ('Office')
ON CONFLICT (name) DO NOTHING;

-- ── Machine registry ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_machines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code  TEXT UNIQUE,                       -- auto MC-0001 (trigger)
  name          TEXT NOT NULL,
  category      TEXT NULL,                          -- machine type
  section       TEXT NULL,                          -- owning area / department
  status        TEXT NOT NULL DEFAULT 'working'
                  CHECK (status IN ('working', 'under_maintenance', 'retired')),
  location      TEXT NULL,
  notes         TEXT NULL,
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS company_machines_section_idx ON public.company_machines (section);
CREATE INDEX IF NOT EXISTS company_machines_status_idx ON public.company_machines (status);

-- Auto machine code: MC-0001, MC-0002, … (flat per-asset serial). Mirrors
-- the activity_register code trigger (mig 101).
CREATE SEQUENCE IF NOT EXISTS public.company_machine_code_seq;

CREATE OR REPLACE FUNCTION public.assign_company_machine_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.machine_code IS NULL THEN
    NEW.machine_code := 'MC-' || lpad(nextval('public.company_machine_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_machine_code ON public.company_machines;
CREATE TRIGGER trg_company_machine_code
  BEFORE INSERT ON public.company_machines
  FOR EACH ROW EXECUTE FUNCTION public.assign_company_machine_code();

-- ── Private storage bucket for ticket photos (used by mig 109) ───────
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance_proofs', 'maintenance_proofs', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS — read-all for authenticated; writes via service-role admin ──
ALTER TABLE public.machine_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_sections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_machines   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_categories' AND policyname='machine_categories_read') THEN
    CREATE POLICY machine_categories_read ON public.machine_categories FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_sections' AND policyname='machine_sections_read') THEN
    CREATE POLICY machine_sections_read ON public.machine_sections FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_machines' AND policyname='company_machines_read') THEN
    CREATE POLICY company_machines_read ON public.company_machines FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.company_machines;
--   DROP TABLE IF EXISTS public.machine_categories;
--   DROP TABLE IF EXISTS public.machine_sections;
--   DROP FUNCTION IF EXISTS public.assign_company_machine_code();
--   DROP SEQUENCE IF EXISTS public.company_machine_code_seq;
--   DELETE FROM storage.buckets WHERE id = 'maintenance_proofs';
