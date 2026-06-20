-- ──────────────────────────────────────────────────────────────────
-- 145 — Dispatch stations + carving→dispatch receipt (Daksh, June 2026)
--
-- Phase 4 of the slab-transfer reconnect. On the Carving-Done APPROVAL
-- form the reviewer now picks a DISPATCH STATION (where the finished
-- slab should be gathered for loading) and may tick SELF-TRANSFER to
-- send it straight to dispatch without waiting for a transfer runner.
--
-- New on carving_items:
--   • dispatch_station_id      — chosen station (routing/grouping)
--   • dispatch_self_transfer   — reviewer bypassed the transfer runner
--   • received_at_dispatch_at  — stamped when the slab actually reaches
--     the dispatch station (by the carving→dispatch transfer, or
--     instantly on self-transfer). This is the gate that makes a
--     carving-done slab CLICKABLE on the Dispatch board (Phase 5).
--   • received_at_dispatch_by  — who brought it in.
--
-- dispatch_stations is a creatable list (pick-or-create on the approval
-- form + Settings). One row is seeded as the default. PURELY ADDITIVE.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.dispatch_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_stations_name_idx
  ON public.dispatch_stations (lower(name));

ALTER TABLE public.dispatch_stations ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

-- Seed one default station so the approval-form dropdown is never empty
-- and there's always a pre-selected option.
INSERT INTO public.dispatch_stations (name, is_default)
VALUES ('Main Dispatch', true)
ON CONFLICT DO NOTHING;

-- Per-slab dispatch routing + receipt.
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS dispatch_station_id UUID NULL REFERENCES public.dispatch_stations(id),
  ADD COLUMN IF NOT EXISTS dispatch_self_transfer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS received_at_dispatch_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS received_at_dispatch_by UUID NULL REFERENCES public.profiles(id);

-- Fast "is this slab in at dispatch yet?" lookup.
CREATE INDEX IF NOT EXISTS carving_items_received_at_dispatch_idx
  ON public.carving_items (received_at_dispatch_at)
  WHERE received_at_dispatch_at IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.carving_items
--     DROP COLUMN IF EXISTS dispatch_station_id,
--     DROP COLUMN IF EXISTS dispatch_self_transfer,
--     DROP COLUMN IF EXISTS received_at_dispatch_at,
--     DROP COLUMN IF EXISTS received_at_dispatch_by;
--   DROP TABLE IF EXISTS public.dispatch_stations;
