-- ──────────────────────────────────────────────────────────────────
-- 132 — Slab cancellation flow (Daksh, June 2026)
--
-- After a slab is physically cut it can break at any later stage.
-- New flow:
--   1. carving_head / senior_incharge REQUEST a cancel (reason +
--      optional photo) from Carving Jobs or Make Dispatch.
--      → cancel_requested_* stamped; slab stays where it is, shown
--        RED + locked (no assign / work order / dispatch) until the
--        owner decides.
--   2. owner / developer APPROVE or REJECT on /tasks/slab-cancels.
--      → reject: request fields cleared, slab back to normal.
--      → approve: status = 'cancelled' (new enum value),
--        cancel_prev_status remembers where it died. In-flight
--        carving_items rows are flipped to 'cancelled' too, but
--        APPROVED carving history is left untouched (stats preserved
--        — no reverse engineering).
--   3. Temple View shows cancelled slabs (new stage bucket) with an
--      alert; the office decides: no replacement, or auto-create an
--      identical new slab (new code, status 'open' → "needs to cut").
--      cancel_resolution / replacement_slab_id record the decision;
--      replacement_of marks the new slab.
--
-- PURELY ADDITIVE: one enum value + nullable columns + one bucket.
-- ──────────────────────────────────────────────────────────────────

-- ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction block.
ALTER TYPE public.slab_status ADD VALUE IF NOT EXISTS 'cancelled';

BEGIN;

ALTER TABLE public.slab_requirements
  -- Request stage
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancel_requested_by UUID NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS cancel_photo_path TEXT NULL,
  -- Owner decision
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_prev_status TEXT NULL,
  -- Temple View resolution
  ADD COLUMN IF NOT EXISTS cancel_resolution TEXT NULL
    CHECK (cancel_resolution IS NULL OR cancel_resolution IN ('no_replacement', 'replaced')),
  ADD COLUMN IF NOT EXISTS replacement_slab_id TEXT NULL,
  -- Set on the NEW slab created to replace a cancelled one
  ADD COLUMN IF NOT EXISTS replacement_of TEXT NULL;

-- Pending-request queue index (owner task panel).
CREATE INDEX IF NOT EXISTS slab_requirements_cancel_pending_idx
  ON public.slab_requirements (cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL;

-- Photo bucket (public — same posture as dispatch_delivery_proofs).
INSERT INTO storage.buckets (id, name, public)
VALUES ('slab_cancel_photos', 'slab_cancel_photos', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.slab_requirements
--     DROP COLUMN IF EXISTS cancel_requested_at, DROP COLUMN IF EXISTS cancel_requested_by,
--     DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS cancel_photo_path,
--     DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancelled_by,
--     DROP COLUMN IF EXISTS cancel_prev_status, DROP COLUMN IF EXISTS cancel_resolution,
--     DROP COLUMN IF EXISTS replacement_slab_id, DROP COLUMN IF EXISTS replacement_of;
--   DELETE FROM storage.buckets WHERE id = 'slab_cancel_photos';
--   -- (enum value 'cancelled' cannot be dropped once present)
