-- ──────────────────────────────────────────────────────────────────
-- 148 — Installation vendor contracts (Daksh, June 2026)
--
-- A standalone Invoicing document, alongside the Work Order Doc: a
-- formal installation contract printed on the company letterhead. The
-- user picks a (creatable) installation vendor + (creatable) project
-- site and a contract price; the PDF is built on demand from the stored
-- snapshot. PURELY ADDITIVE — three new tables, nothing else touched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- Installation contractors — a simple creatable master for this module.
CREATE TABLE IF NOT EXISTS public.install_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT NULL,
  phone TEXT NULL,
  address TEXT NULL,
  gstin TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS install_vendors_name_idx ON public.install_vendors (lower(name));
ALTER TABLE public.install_vendors ENABLE ROW LEVEL SECURITY;

-- Project / temple sites — creatable master.
CREATE TABLE IF NOT EXISTS public.install_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT NOT NULL,
  location TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS install_sites_name_idx ON public.install_sites (lower(project_name));
ALTER TABLE public.install_sites ENABLE ROW LEVEL SECURITY;

-- Issued contracts — snapshot the vendor + site so the printed PDF is
-- frozen even if the masters change later. Soft-deletable like the WO doc.
CREATE TABLE IF NOT EXISTS public.install_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no TEXT NOT NULL,
  install_vendor_id UUID NULL REFERENCES public.install_vendors(id),
  install_site_id UUID NULL REFERENCES public.install_sites(id),
  vendor_name TEXT NOT NULL,
  vendor_contact TEXT NULL,
  vendor_phone TEXT NULL,
  vendor_address TEXT NULL,
  vendor_gstin TEXT NULL,
  site_project TEXT NOT NULL,
  site_location TEXT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  price_words TEXT NULL,
  scope_note TEXT NULL,
  doc_date DATE NULL,
  deleted_at TIMESTAMPTZ NULL,
  deleted_by UUID NULL REFERENCES public.profiles(id),
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.install_contracts ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.install_contracts;
--   DROP TABLE IF EXISTS public.install_sites;
--   DROP TABLE IF EXISTS public.install_vendors;
