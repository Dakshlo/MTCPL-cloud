-- ──────────────────────────────────────────────────────────────────────
-- Migration 038 — Invoicing module (outgoing customer invoices)
-- ──────────────────────────────────────────────────────────────────────
-- Adds a fourth department: Invoicing. Confusingly different from
-- Finance — Finance handles INCOMING supplier bills (mig 028), this
-- handles OUTGOING customer invoices (slabs sold to temples).
--
-- Schema:
--   • invoices       — header row per invoice (customer + totals)
--   • invoice_items  — line items per invoice (description / qty / rate)
--   • invoice_number_seq + trigger — auto-generates INV-YYYY-N numbers
--
-- Plus housekeeping:
--   • profiles.active_department CHECK extended to include 'invoicing'
--     so dev/owner can switch into this department.
--   • system_settings 'invoicing_status' row so the per-department
--     maintenance toggle from mig 036 has somewhere to read/write.
--   • RLS enabled, authenticated read, writes via admin client only
--     (the server actions are role-gated separately).

BEGIN;

-- Extend the active_department check to recognise 'invoicing'.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_department_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_department_check
    CHECK (active_department IN ('production', 'finance', 'inventory', 'invoicing'));

-- Seed the invoicing maintenance row.
INSERT INTO public.system_settings (key, value)
VALUES ('invoicing_status', '{"down":false,"message":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Sequence + trigger for invoice numbers ──────────────────────
-- Format: INV-YYYY-N (N = monotonically increasing across years —
-- matches the bill_token_seq style from migration 030 for consistency).
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq;

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  next_n BIGINT;
  yr     TEXT;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;
  yr := to_char(COALESCE(NEW.invoice_date, CURRENT_DATE), 'YYYY');
  next_n := nextval('public.invoice_number_seq');
  NEW.invoice_number := 'INV-' || yr || '-' || next_n::text;
  RETURN NEW;
END;
$$;

-- ── invoices ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    TEXT UNIQUE,            -- auto-set by trigger if empty
  invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Customer block
  customer_name     TEXT NOT NULL,
  customer_address  TEXT NULL,
  customer_gstin    TEXT NULL,
  customer_phone    TEXT NULL,
  -- Totals (subtotal entered, GST computed, total computed)
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  gst_percent       NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (gst_percent >= 0 AND gst_percent <= 100),
  amount_gst        NUMERIC(14,2) NOT NULL GENERATED ALWAYS AS
                      (ROUND(subtotal * gst_percent / 100, 2)) STORED,
  total             NUMERIC(14,2) NOT NULL GENERATED ALWAYS AS
                      (subtotal + ROUND(subtotal * gst_percent / 100, 2)) STORED,
  notes             TEXT NULL,
  created_by        UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS invoices_assign_number ON public.invoices;
CREATE TRIGGER invoices_assign_number BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

CREATE INDEX IF NOT EXISTS invoices_date_idx
  ON public.invoices (invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_customer_idx
  ON public.invoices (customer_name);

-- ── invoice_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  rate        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount      NUMERIC(14,2) NOT NULL GENERATED ALWAYS AS (quantity * rate) STORED,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx
  ON public.invoice_items (invoice_id, position);

-- ── RLS: authenticated read; writes through admin client only ──
ALTER TABLE public.invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_read_authenticated"      ON public.invoices;
DROP POLICY IF EXISTS "invoice_items_read_authenticated" ON public.invoice_items;
CREATE POLICY "invoices_read_authenticated"      ON public.invoices       FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "invoice_items_read_authenticated" ON public.invoice_items  FOR SELECT TO authenticated USING (TRUE);

NOTIFY pgrst, 'reload schema';

COMMIT;
