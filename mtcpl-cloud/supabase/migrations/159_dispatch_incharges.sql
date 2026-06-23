-- 159 — Multiple dispatch incharges, linked to temples.
--
-- Replaces the single global "dispatch handling man" (app_settings
-- 'dispatch_handling_man') with a roster of incharges, each linkable to many
-- temples (one incharge can cover several sites; a temple has one incharge).
-- The challan resolves the incharge as: the dispatch's per-trip override →
-- the temple's linked incharge → the legacy global handling man (fallback).
--
-- Additive + idempotent. The legacy app_settings key stays as the final
-- fallback so nothing breaks before temples are linked.

CREATE TABLE IF NOT EXISTS public.dispatch_incharges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- A temple's default dispatch incharge (one incharge → many temples).
ALTER TABLE public.temples
  ADD COLUMN IF NOT EXISTS dispatch_incharge_id uuid
    REFERENCES public.dispatch_incharges(id) ON DELETE SET NULL;

-- Per-dispatch override chosen on the Check & verify page.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS incharge_id uuid
    REFERENCES public.dispatch_incharges(id) ON DELETE SET NULL;

-- Seed the existing single handling man (POSA RAM) as the first incharge so
-- nothing is lost; skip if one with that name already exists (re-run safe).
INSERT INTO public.dispatch_incharges (name, phone)
SELECT s.value->>'name', NULLIF(s.value->>'phone', '')
FROM public.app_settings s
WHERE s.key = 'dispatch_handling_man'
  AND COALESCE(s.value->>'name', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.dispatch_incharges di WHERE di.name = s.value->>'name'
  );
