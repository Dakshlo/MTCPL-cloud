-- Migration 109 — Maintenance department: repair tickets + workflow (Daksh, June 2026)
--
-- The maintenance-ticket lifecycle for company machines (mig 108):
--   raised → inspecting → (minor: completed)
--                       → (major: awaiting_approval → in_repair → completed)
--   plus rejected / cancelled.
-- Administration inspects; for a major repair they fill a simple quotation
-- (total amount + repairer + scope + expected days); the owner approves or
-- rejects; on approval the repair timeline starts and the machine flips to
-- under_maintenance; on completion it goes back to working.
--
-- SAFETY: brand-new table only. No other table touched, no enum changes.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.machine_maintenance_tickets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no          TEXT UNIQUE,                  -- auto MT-YYYY-NNNN (trigger)
  machine_id         UUID NOT NULL REFERENCES public.company_machines(id) ON DELETE CASCADE,
  machine_name       TEXT NOT NULL,                -- snapshot
  section            TEXT NULL,                    -- snapshot of machine section
  problem            TEXT NOT NULL,
  priority           TEXT NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status             TEXT NOT NULL DEFAULT 'raised'
                       CHECK (status IN ('raised', 'inspecting', 'awaiting_approval',
                                         'in_repair', 'completed', 'rejected', 'cancelled')),
  resolution_kind    TEXT NULL CHECK (resolution_kind IS NULL OR resolution_kind IN ('minor', 'major')),

  inspection_notes   TEXT NULL,

  -- Photos (private bucket maintenance_proofs from mig 108)
  problem_photo_path TEXT NULL,
  problem_photo_mime TEXT NULL,
  done_photo_path    TEXT NULL,
  done_photo_mime    TEXT NULL,

  -- Simple quotation (filled by administration for a major repair)
  quote_amount       NUMERIC(14,2) NULL,
  quote_vendor       TEXT NULL,
  quote_scope        TEXT NULL,
  quote_expected_days INT NULL,
  quoted_by          UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  quoted_at          TIMESTAMPTZ NULL,

  -- Owner approval / rejection
  approved_by        UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ NULL,
  rejected_by        UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at        TIMESTAMPTZ NULL,
  rejection_reason   TEXT NULL,

  -- Repair timeline
  repair_started_at  TIMESTAMPTZ NULL,
  repair_expected_at DATE NULL,
  repair_completed_at TIMESTAMPTZ NULL,
  completed_by       UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Who raised / inspected + housekeeping
  raised_by          UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  raised_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inspected_by       UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspected_at       TIMESTAMPTZ NULL,
  cancel_reason      TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mmt_machine_idx ON public.machine_maintenance_tickets (machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mmt_open_idx ON public.machine_maintenance_tickets (status)
  WHERE status NOT IN ('completed', 'cancelled', 'rejected');

-- Auto ticket number: MT-YYYY-NNNN
CREATE SEQUENCE IF NOT EXISTS public.maintenance_ticket_seq;

CREATE OR REPLACE FUNCTION public.assign_maintenance_ticket_no()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_no IS NULL THEN
    NEW.ticket_no := 'MT-' || to_char(NOW(), 'YYYY') || '-' ||
      lpad(nextval('public.maintenance_ticket_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_maintenance_ticket_no ON public.machine_maintenance_tickets;
CREATE TRIGGER trg_maintenance_ticket_no
  BEFORE INSERT ON public.machine_maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION public.assign_maintenance_ticket_no();

-- RLS — read-all for authenticated; writes via service-role admin client.
ALTER TABLE public.machine_maintenance_tickets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_maintenance_tickets' AND policyname='mmt_read') THEN
    CREATE POLICY mmt_read ON public.machine_maintenance_tickets FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.machine_maintenance_tickets;
--   DROP FUNCTION IF EXISTS public.assign_maintenance_ticket_no();
--   DROP SEQUENCE IF EXISTS public.maintenance_ticket_seq;
