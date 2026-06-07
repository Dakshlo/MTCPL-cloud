-- Migration 106 — Saved vendors for the manual Work Order Document (Daksh, June 2026)
--
-- A lightweight, standalone address book for the /invoicing/work-order-doc
-- generator so the user doesn't retype vendor name + address each time.
-- Pick a saved vendor → name + address auto-fill (still editable). Separate
-- from the system's CNC/carving `vendors` table — this is just name + address
-- for the document.
--
-- SAFETY: brand-new table only. No other table touched, no enum changes.
-- RLS read-all for authenticated; writes via the service-role admin client,
-- app-gated to invoicing roles. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoicing_wo_vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT NULL,
  created_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoicing_wo_vendors_name_idx
  ON public.invoicing_wo_vendors (name);

ALTER TABLE public.invoicing_wo_vendors ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='invoicing_wo_vendors'
                   AND policyname='invoicing_wo_vendors_read') THEN
    CREATE POLICY invoicing_wo_vendors_read ON public.invoicing_wo_vendors
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.invoicing_wo_vendors;
