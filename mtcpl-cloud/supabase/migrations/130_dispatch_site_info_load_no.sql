-- ──────────────────────────────────────────────────────────────────
-- 130 — Dispatch challan v2: temple site info, per-temple load numbers,
--        per-slab weights, direct dispatch (Daksh, June 2026)
--
-- 1. temples — site details that auto-fill every dispatch challan:
--      site_location          where the temple site is (Bill-To address)
--      site_incharge_name/-phone   client-side site incharge
--      installer_name/-phone       contractor we hired for installation
--
-- 2. app_settings — tiny key/value store; first key is the fixed MTCPL
--    site handling man shown on all challans (Posa Ram), editable from
--    Settings instead of hardcoded.
--
-- 3. dispatches.load_number — per-TEMPLE load counter (1, 2, 3… each
--    temple independently; challan_number stays the global sequence).
--    Backfills existing dispatches chronologically. Unique index keeps
--    the per-temple sequence collision-safe (action retries on 23505).
--
-- 4. dispatch_logs.weight_tonnes — per-slab weight entered at dispatch
--    creation; challan shows per-slab weight + net weight total.
--    Also: carving_item_id becomes NULLABLE — direct-dispatch slabs
--    (never carved) have no carving_items row.
--
-- 5. slab_requirements.direct_dispatched_at/by — permanent record that
--    a slab skipped carving and went straight to dispatch.
--
-- PURELY ADDITIVE (plus one DROP NOT NULL). No data destroyed.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1 ── temple site info
ALTER TABLE public.temples
  ADD COLUMN IF NOT EXISTS site_location TEXT NULL,
  ADD COLUMN IF NOT EXISTS site_incharge_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS site_incharge_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS installer_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS installer_phone TEXT NULL;

-- 2 ── app settings key/value store + handling-man seed
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.profiles(id)
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

INSERT INTO public.app_settings (key, value)
VALUES ('dispatch_handling_man', '{"name": "POSA RAM", "phone": "8949783579"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3 ── per-temple load number
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS load_number INTEGER NULL;

-- Backfill existing dispatches chronologically within each temple.
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY temple ORDER BY dispatched_at, id) AS rn
  FROM public.dispatches
)
UPDATE public.dispatches d
   SET load_number = n.rn
  FROM numbered n
 WHERE d.id = n.id
   AND d.load_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dispatches_temple_load_idx
  ON public.dispatches (temple, load_number)
  WHERE load_number IS NOT NULL;

-- 4 ── per-slab weight + nullable carving link
ALTER TABLE public.dispatch_logs
  ADD COLUMN IF NOT EXISTS weight_tonnes NUMERIC NULL;
ALTER TABLE public.dispatch_logs
  ALTER COLUMN carving_item_id DROP NOT NULL;

-- 5 ── direct-dispatch record
ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS direct_dispatched_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS direct_dispatched_by UUID NULL REFERENCES public.profiles(id);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.temples DROP COLUMN IF EXISTS site_location,
--     DROP COLUMN IF EXISTS site_incharge_name, DROP COLUMN IF EXISTS site_incharge_phone,
--     DROP COLUMN IF EXISTS installer_name, DROP COLUMN IF EXISTS installer_phone;
--   DROP TABLE IF EXISTS public.app_settings;
--   ALTER TABLE public.dispatches DROP COLUMN IF EXISTS load_number;
--   ALTER TABLE public.dispatch_logs DROP COLUMN IF EXISTS weight_tonnes;
--   -- (carving_item_id NOT NULL cannot be restored once NULL rows exist)
--   ALTER TABLE public.slab_requirements DROP COLUMN IF EXISTS direct_dispatched_at,
--     DROP COLUMN IF EXISTS direct_dispatched_by;
