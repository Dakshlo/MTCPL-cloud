-- ──────────────────────────────────────────────────────────────────
-- Migration 058: Invoicing v2 — parties + challans + invoice link
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Today /invoicing is a single-step flow: hit "+ New Invoice", type
-- a customer name + line items + GST, submit. There's no customer
-- master, no delivery-note (challan) concept, no PDF export beyond
-- window.print().
--
-- Daksh wants to restructure it around the actual workflow:
--   1. Party master (invoice_parties) — like bill_vendors, but
--      customer-side. Reusable across challans + invoices.
--   2. Challan (delivery note) — items + qty, NO money. One party,
--      many challans. Auto-numbered CH-YYYY-N.
--   3. Convert challan → invoice — opens invoice form with party +
--      items pre-filled, user adds rates + GST. Challan stays in
--      the system, linked to the resulting invoice.
--
-- Stage 2 (deferred, NOT in this migration):
--   • Dispatch → provisional-challan pipeline — waiting on carving
--     production being well-integrated.
--   • E-way bill API (NIC / GSP) — Daksh: "after invoice it's not
--     just print, we need to connect with api to get eway bill."
--     That'll add an `eway_bills` table + HSN codes on line items.
--
-- Three new tables, one ALTER on existing `invoices`. No new role
-- (final_auditor already exists from mig 053). Single BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Invoice parties (customer master) ──────────────────────────
-- Mirrors bill_vendors in shape, minus payment-side fields (no bank
-- account / HDFC bene name / payment terms / TDS — those concern
-- paying out, not receiving from). Plus customer-side basics.
CREATE TABLE IF NOT EXISTS public.invoice_parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  gstin       TEXT NULL,
  pan         TEXT NULL,
  address     TEXT NULL,
  phone       TEXT NULL,
  email       TEXT NULL,
  notes       TEXT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS invoice_parties_active_name_idx
  ON public.invoice_parties (name) WHERE is_active IS TRUE;

ALTER TABLE public.invoice_parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_parties_auth_read ON public.invoice_parties
  FOR SELECT TO authenticated USING (true);

-- ── 2. Challans (delivery notes) + items ──────────────────────────
CREATE SEQUENCE IF NOT EXISTS challan_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.challans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_number        TEXT UNIQUE,             -- auto: CH-YYYY-N
  challan_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_party_id      UUID NOT NULL
                          REFERENCES public.invoice_parties(id) ON DELETE RESTRICT,
  notes                 TEXT NULL,
  -- Conversion linkage: set when the challan is materialised into
  -- an invoice. converted_invoice_id → the new invoice row;
  -- converted_at → timestamp.
  converted_invoice_id  UUID NULL
                          REFERENCES public.invoices(id) ON DELETE SET NULL,
  converted_at          TIMESTAMPTZ NULL,
  -- Soft-cancel pattern (same as accounts / personal-ledger).
  cancelled_at          TIMESTAMPTZ NULL,
  cancel_reason         TEXT NULL,
  created_by            UUID NULL
                          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS challans_party_open_idx
  ON public.challans (invoice_party_id, challan_date DESC)
  WHERE cancelled_at IS NULL AND converted_invoice_id IS NULL;

CREATE INDEX IF NOT EXISTS challans_date_idx
  ON public.challans (challan_date DESC)
  WHERE cancelled_at IS NULL;

-- Auto-number trigger — mirrors the existing assign_invoice_number
-- pattern from mig 038. Format: CH-2026-1, CH-2026-2, etc.
CREATE OR REPLACE FUNCTION public.assign_challan_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.challan_number IS NULL OR NEW.challan_number = '' THEN
    NEW.challan_number := 'CH-' ||
      EXTRACT(YEAR FROM NEW.challan_date) || '-' ||
      nextval('public.challan_number_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_challan_number ON public.challans;
CREATE TRIGGER trg_assign_challan_number
  BEFORE INSERT ON public.challans
  FOR EACH ROW EXECUTE FUNCTION public.assign_challan_number();

ALTER TABLE public.challans ENABLE ROW LEVEL SECURITY;
CREATE POLICY challans_auth_read ON public.challans
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.challan_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id  UUID NOT NULL
                REFERENCES public.challans(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  quantity    NUMERIC(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit        TEXT NULL,           -- "sft" / "cft" / "pcs" / NULL
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS challan_items_challan_idx
  ON public.challan_items (challan_id, position);

ALTER TABLE public.challan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY challan_items_auth_read ON public.challan_items
  FOR SELECT TO authenticated USING (true);

-- ── 3. Extend invoices with party + source-challan links ──────────
-- customer_name stays NOT NULL — legacy invoices still depend on it,
-- and new invoices via the party flow will also populate it (copied
-- from the party row) so SELECTs and the existing print view need
-- no changes.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_party_id  UUID NULL
    REFERENCES public.invoice_parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_challan_id UUID NULL
    REFERENCES public.challans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_party_idx
  ON public.invoices (invoice_party_id, invoice_date DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
