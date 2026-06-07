-- Migration 103 — Activity Register goes site-wise (Daksh, June 2026)
--
-- The register is now organised by SITE (e.g. "L&T"). Each site:
--   • is created by the owner/dev,
--   • carries its OWN code scheme — a prefix + a per-site running number,
--     so codes look like  Lnt/OOS/001, Lnt/OOS/002, …  (prefix "Lnt/OOS",
--     3-digit zero-padded serial). The serial is per-site.
-- Entries are created INSIDE a site and gain a "concern person" field.
-- (Reference becomes an Email / WhatsApp / Hand-to-hand choice — that's a
-- UI dropdown stored in the existing reference TEXT column, no DDL needed.)
--
-- SAFETY: one brand-new table + three NULLABLE columns on activity_register.
-- No other table touched, no enum changes, no data migration. Any entries
-- created under mig 101 (site-less) keep their rows untouched — they simply
-- have site_id = NULL. Fully idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  code_prefix  TEXT NOT NULL UNIQUE,                 -- e.g. 'Lnt/OOS' -> Lnt/OOS/001
  code_pad     INT  NOT NULL DEFAULT 3 CHECK (code_pad BETWEEN 1 AND 8),
  created_by   UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NULL,
  updated_by   UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.activity_register
  ADD COLUMN IF NOT EXISTS site_id        UUID NULL REFERENCES public.activity_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concern_person TEXT NULL,
  ADD COLUMN IF NOT EXISTS site_seq       INT  NULL;  -- the NNN in <prefix>/NNN, per site

-- One serial per site. Partial unique so the legacy site-less rows
-- (site_id NULL) don't clash. The app computes the next serial.
CREATE UNIQUE INDEX IF NOT EXISTS activity_register_site_seq_uq
  ON public.activity_register (site_id, site_seq)
  WHERE site_id IS NOT NULL AND site_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_register_site_idx
  ON public.activity_register (site_id, created_at DESC);

ALTER TABLE public.activity_sites ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='activity_sites'
                   AND policyname='activity_sites_read') THEN
    CREATE POLICY activity_sites_read ON public.activity_sites
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS public.activity_register_site_seq_uq;
--   DROP INDEX IF EXISTS public.activity_register_site_idx;
--   ALTER TABLE public.activity_register
--     DROP COLUMN IF EXISTS site_id,
--     DROP COLUMN IF EXISTS concern_person,
--     DROP COLUMN IF EXISTS site_seq;
--   DROP TABLE IF EXISTS public.activity_sites;
