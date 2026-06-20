-- ──────────────────────────────────────────────────────────────────
-- 144 — Trucks (transfer fleet) + per-claim truck (Daksh, June 2026)
--
-- Phase 3 of the slab-transfer reconnect. When a runner CLAIMS a
-- cutting→carving transfer they now also pick WHICH TRUCK carries the
-- load. The truck is recorded on the claimed carving_items rows.
--
-- "Busy" is DERIVED, never stored: a truck is busy iff it has at least
-- one carving_items row with claim_truck_id = truck.id AND the slab is
-- still in flight (received_at_vendor_at IS NULL). Deriving sidesteps
-- the orphaned-busy / race problems a mutable status column invites —
-- delivering or unclaiming a slab frees the truck automatically.
--
-- Trucks are a creatable list (pick-or-create on the claim form, plus
-- Settings management). PURELY ADDITIVE — one table + one nullable FK.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.trucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One truck per case-folded name (so "MH-04-1234" / "mh-04-1234" can't
-- both exist). The create-inline upsert targets this index.
CREATE UNIQUE INDEX IF NOT EXISTS trucks_name_idx
  ON public.trucks (lower(name));

ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

-- Which truck carried a given transfer claim. NULL until a runner
-- picks one at claim time; kept on the row after delivery for audit
-- ("this truck delivered it") — busy-derivation ignores delivered rows.
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS claim_truck_id UUID NULL REFERENCES public.trucks(id);

-- Fast "is this truck busy?" lookup: active, undelivered claims by truck.
CREATE INDEX IF NOT EXISTS carving_items_claim_truck_active_idx
  ON public.carving_items (claim_truck_id)
  WHERE claim_truck_id IS NOT NULL AND received_at_vendor_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.carving_items DROP COLUMN IF EXISTS claim_truck_id;
--   DROP TABLE IF EXISTS public.trucks;
