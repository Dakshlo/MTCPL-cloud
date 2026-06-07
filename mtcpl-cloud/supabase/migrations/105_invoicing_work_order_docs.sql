-- Migration 105 — Invoicing: manual Work Order Document generator (Daksh, June 2026)
--
-- A standalone document generator that is NOT linked to carving work orders
-- or any incoming/invoicing logic. The user types everything by hand
-- (vendor, address, job-work description + no., unit cft/sft, quantity,
-- price) and the system prints a letterhead PDF in the format we already
-- use, and keeps a record of every doc generated.
--
-- SAFETY: brand-new table only. No other table touched, no enum changes.
-- RLS read-all for authenticated (mirrors mig 096); writes go through the
-- service-role admin client, app-gated to invoicing roles. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoicing_work_order_docs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor          TEXT NOT NULL,
  address         TEXT NULL,
  job_description TEXT NULL,
  job_work_no     TEXT NULL,                       -- user-entered work order no.
  unit            TEXT NOT NULL CHECK (unit IN ('cft', 'sft')),
  quantity        NUMERIC(14,3) NOT NULL,
  rate            NUMERIC(14,2) NOT NULL,          -- price per unit
  total           NUMERIC(16,2) NOT NULL,          -- quantity * rate (frozen)
  created_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoicing_work_order_docs_created_idx
  ON public.invoicing_work_order_docs (created_at DESC);

ALTER TABLE public.invoicing_work_order_docs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='invoicing_work_order_docs'
                   AND policyname='invoicing_work_order_docs_read') THEN
    CREATE POLICY invoicing_work_order_docs_read ON public.invoicing_work_order_docs
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.invoicing_work_order_docs;
