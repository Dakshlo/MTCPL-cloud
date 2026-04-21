-- Dispatch station — batch-level record of trucks going out to temples.
--
-- One `dispatches` row = one truck run to one temple, carrying N slabs.
-- Each slab is still tracked individually in `dispatch_logs` (which
-- already exists), but now every log row belongs to a batch via
-- dispatch_logs.dispatch_id.
--
-- The existing single-slab carving-detail "Mark Dispatched" button keeps
-- working — those rows have dispatch_id = NULL and show up in a
-- "Legacy single-slab dispatches" section of the Delivered archive.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  temple TEXT NOT NULL,
  vehicle_no TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  expected_delivery_date DATE,
  notes TEXT,

  dispatched_by UUID REFERENCES public.profiles(id),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Filled when the site engineer reports receipt (via developer click).
  delivered_at TIMESTAMPTZ,
  delivered_by UUID REFERENCES public.profiles(id),
  receiver_name TEXT,
  delivery_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatches_temple_idx ON public.dispatches(temple);
CREATE INDEX IF NOT EXISTS dispatches_not_delivered_idx
  ON public.dispatches(dispatched_at DESC)
  WHERE delivered_at IS NULL;

-- Link each per-slab dispatch_log to its batch. Nullable so old
-- one-off dispatches still work unchanged.
ALTER TABLE public.dispatch_logs
  ADD COLUMN IF NOT EXISTS dispatch_id UUID
    REFERENCES public.dispatches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dispatch_logs_dispatch_id_idx
  ON public.dispatch_logs(dispatch_id)
  WHERE dispatch_id IS NOT NULL;

-- RLS on — app code uses createAdminSupabaseClient() which bypasses.
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

COMMIT;
