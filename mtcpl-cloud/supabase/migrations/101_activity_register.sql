-- Migration 101 — Activity Register (Daksh, June 2026)
--
-- WHAT / WHY
-- A standalone, tamper-evident register of company activities + proof.
-- Example: "Sent a black-granite demo sample to L&T, Mumbai" with a photo
-- of the sample / the courier receipt attached. Two years later, if a
-- client claims "you never sent it", the office can SEARCH the register
-- and pull up the dated entry + its proof. Excel-style list:
--   Sr / Code (auto AR-YYYY-NNNN) / Date / Activity / Person / Reference / Proof.
--
-- For now only owner + developer can open / manage it; later we link the
-- specific staff who need it (a profile flag, like can_assign_carving).
--
-- SAFETY: brand-new table + brand-new private Storage bucket ONLY.
-- No other table is touched, no enum changes, no data migration. RLS
-- read-all for authenticated (mirrors mig 096); ALL writes go through the
-- service-role admin client and are app-gated to owner/developer.
-- Fully idempotent.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.activity_register_code_seq;

CREATE TABLE IF NOT EXISTS public.activity_register (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_code         TEXT UNIQUE,                        -- auto AR-YYYY-NNNN
  activity_date      DATE NOT NULL DEFAULT CURRENT_DATE, -- when the activity happened
  activity           TEXT NOT NULL,                      -- what was done
  person             TEXT NULL,                          -- who did it / contact
  reference          TEXT NULL,                          -- PO no, tracking, party, etc.
  proof_path         TEXT NULL,                          -- object in activity_proofs bucket
  proof_mime         TEXT NULL,
  proof_uploaded_at  TIMESTAMPTZ NULL,
  created_by         UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NULL,
  updated_by         UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Auto-number AR-YYYY-NNNN (mirror assign_carving_challan_number).
CREATE OR REPLACE FUNCTION public.assign_activity_register_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entry_code IS NULL THEN
    NEW.entry_code := 'AR-' || to_char(NOW(), 'YYYY') || '-' ||
      lpad(nextval('public.activity_register_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_register_code ON public.activity_register;
CREATE TRIGGER trg_activity_register_code
  BEFORE INSERT ON public.activity_register
  FOR EACH ROW EXECUTE FUNCTION public.assign_activity_register_code();

CREATE INDEX IF NOT EXISTS activity_register_created_idx
  ON public.activity_register (created_at DESC);

ALTER TABLE public.activity_register ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='activity_register'
                   AND policyname='activity_register_read') THEN
    CREATE POLICY activity_register_read ON public.activity_register
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Private Storage bucket for proof files (photos / PDFs). Idempotent.
-- The app reads/writes through the service-role admin client (bypasses
-- RLS), so no storage.objects policies are required.
INSERT INTO storage.buckets (id, name, public)
VALUES ('activity_proofs', 'activity_proofs', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.activity_register;
--   DROP FUNCTION IF EXISTS public.assign_activity_register_code();
--   DROP SEQUENCE IF EXISTS public.activity_register_code_seq;
--   DELETE FROM storage.buckets WHERE id = 'activity_proofs';
