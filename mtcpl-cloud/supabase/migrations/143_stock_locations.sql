-- ──────────────────────────────────────────────────────────────────
-- 143 — Curated stock-location list (Daksh, June 2026)
--
-- Cutting-Done captures WHERE the cut slabs are physically stocked
-- (slab_requirements.stock_location, free text). We're making that
-- field MANDATORY and turning it into a pick-or-create combobox so
-- the floor reuses consistent location names instead of typos — and
-- so a self-transferred slab always carries a real location.
--
-- This table is the curated source for the dropdown. New names typed
-- on the Cutting-Done form are upserted here on submit (create-inline),
-- so the list grows organically. PURELY ADDITIVE — one table, seeded
-- from the distinct locations already in use. No column/enum changes.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One location per case-folded name (so "Yard 1" / "yard 1" can't both
-- exist). The create-inline upsert targets this index.
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_name_idx
  ON public.stock_locations (lower(name));

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies) — same posture as other admin tables.

-- Seed from the distinct stock locations already recorded on slabs, so
-- the dropdown isn't empty on day one. DISTINCT ON case-folds to avoid
-- duplicate-key conflicts within this single INSERT.
INSERT INTO public.stock_locations (name)
SELECT DISTINCT ON (lower(trim(stock_location))) trim(stock_location)
FROM public.slab_requirements
WHERE stock_location IS NOT NULL AND trim(stock_location) <> ''
ORDER BY lower(trim(stock_location))
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.stock_locations;
