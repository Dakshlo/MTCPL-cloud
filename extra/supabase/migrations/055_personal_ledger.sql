-- ──────────────────────────────────────────────────────────────────
-- Migration 055: Personal ledger (Daksh's private invoice tracker)
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh wants a small accounts-receivable scratchpad for his own
-- personal money — informal parties he invoices on the side,
-- payments received split by bucket (default "B" / "C",
-- renameable), running balance per party.
--
-- Built explicitly as a PERSONAL tool, NOT a parallel company
-- ledger:
--   • Page banner + sidebar label + Excel filename + audit action
--     prefix all read "Personal — not company books".
--   • Every row scoped to owner_profile_id; RLS enforces no
--     cross-user reads even via anon / auth keys.
--   • Every mutation audit-logged (personal_ledger_*).
--   • Zero integration with bills, bill_payments, bill_vendors,
--     cnc_*, invoicing, or any other company-financial table.
--
-- Four tables, all owner-scoped:
--   personal_ledger_parties    — informal party master (name only)
--   personal_ledger_buckets    — receipt buckets (default B / C)
--   personal_ledger_invoices   — invoice header + items_json blob
--   personal_ledger_receipts   — payment received against a party
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_ledger_parties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id  UUID NOT NULL
                      REFERENCES public.profiles(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS public.personal_ledger_buckets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id  UUID NOT NULL
                      REFERENCES public.profiles(id) ON DELETE CASCADE,
  label             TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  archived_at       TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS public.personal_ledger_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL
                      REFERENCES public.personal_ledger_parties(id) ON DELETE RESTRICT,
  owner_profile_id  UUID NOT NULL
                      REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_no        TEXT NOT NULL CHECK (length(trim(invoice_no)) BETWEEN 1 AND 60),
  invoice_date      DATE NOT NULL,
  -- items_json is a JSONB array. Each element:
  --   { description: string, stone_type: string,
  --     unit: "sft" | "cft", quantity: number,
  --     rate: number, line_total: number }
  -- subtotal = sum(line_total). GST is a manual ₹ amount, not %.
  items_json        JSONB NOT NULL,
  subtotal          NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  gst_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
  total             NUMERIC(14, 2) GENERATED ALWAYS AS (subtotal + gst_amount) STORED,
  notes             TEXT NULL CHECK (length(coalesce(notes, '')) <= 1000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMPTZ NULL,
  cancel_reason     TEXT NULL
);

CREATE TABLE IF NOT EXISTS public.personal_ledger_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL
                      REFERENCES public.personal_ledger_parties(id) ON DELETE RESTRICT,
  owner_profile_id  UUID NOT NULL
                      REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket_id         UUID NOT NULL
                      REFERENCES public.personal_ledger_buckets(id) ON DELETE RESTRICT,
  amount            NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  receipt_date      DATE NOT NULL,
  note              TEXT NULL CHECK (length(coalesce(note, '')) <= 500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMPTZ NULL,
  cancel_reason     TEXT NULL
);

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS pl_parties_owner_idx
  ON public.personal_ledger_parties (owner_profile_id, name)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS pl_buckets_owner_idx
  ON public.personal_ledger_buckets (owner_profile_id, sort_order)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS pl_invoices_party_idx
  ON public.personal_ledger_invoices (party_id, invoice_date DESC)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS pl_receipts_party_idx
  ON public.personal_ledger_receipts (party_id, receipt_date DESC)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS pl_receipts_bucket_idx
  ON public.personal_ledger_receipts (bucket_id)
  WHERE cancelled_at IS NULL;

-- ── RLS — owner-scoped read / write only ────────────────────────
-- App actions all use the admin client (service_role bypasses RLS,
-- same pattern as every other table in this app). RLS is the
-- safety net for any future code path that uses anon / auth keys.
ALTER TABLE public.personal_ledger_parties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_ledger_buckets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_ledger_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_ledger_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pl_parties_owner_select ON public.personal_ledger_parties
  FOR SELECT USING (owner_profile_id = auth.uid());
CREATE POLICY pl_parties_owner_write ON public.personal_ledger_parties
  FOR ALL USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());

CREATE POLICY pl_buckets_owner_select ON public.personal_ledger_buckets
  FOR SELECT USING (owner_profile_id = auth.uid());
CREATE POLICY pl_buckets_owner_write ON public.personal_ledger_buckets
  FOR ALL USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());

CREATE POLICY pl_invoices_owner_select ON public.personal_ledger_invoices
  FOR SELECT USING (owner_profile_id = auth.uid());
CREATE POLICY pl_invoices_owner_write ON public.personal_ledger_invoices
  FOR ALL USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());

CREATE POLICY pl_receipts_owner_select ON public.personal_ledger_receipts
  FOR SELECT USING (owner_profile_id = auth.uid());
CREATE POLICY pl_receipts_owner_write ON public.personal_ledger_receipts
  FOR ALL USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());

NOTIFY pgrst, 'reload schema';

COMMIT;
