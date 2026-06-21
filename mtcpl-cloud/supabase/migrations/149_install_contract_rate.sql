-- ──────────────────────────────────────────────────────────────────
-- 149 — Install contract: rate-per-unit + deletable masters (Daksh, Jun 2026)
--
-- (a) Contracts are priced as a RATE per unit (per CFT / SFT / installation
--     / piece) or a lump sum — store the unit alongside the price.
-- (b) Allow a vendor / site to be hard-deleted once all its contracts are
--     cancelled: switch the contract FKs to ON DELETE SET NULL so the
--     cancelled contracts keep their snapshot (vendor_name / site_project)
--     but lose the link. PURELY ADDITIVE / constraint reshape.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.install_contracts
  ADD COLUMN IF NOT EXISTS price_unit TEXT NULL;

ALTER TABLE public.install_contracts
  DROP CONSTRAINT IF EXISTS install_contracts_install_vendor_id_fkey;
ALTER TABLE public.install_contracts
  ADD CONSTRAINT install_contracts_install_vendor_id_fkey
  FOREIGN KEY (install_vendor_id) REFERENCES public.install_vendors(id) ON DELETE SET NULL;

ALTER TABLE public.install_contracts
  DROP CONSTRAINT IF EXISTS install_contracts_install_site_id_fkey;
ALTER TABLE public.install_contracts
  ADD CONSTRAINT install_contracts_install_site_id_fkey
  FOREIGN KEY (install_site_id) REFERENCES public.install_sites(id) ON DELETE SET NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
