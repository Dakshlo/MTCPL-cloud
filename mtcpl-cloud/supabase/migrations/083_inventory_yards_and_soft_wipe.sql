-- ──────────────────────────────────────────────────────────────────
-- Mig 083 — Inventory yards + soft wipe of catalog & movements
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh June 2026 — major inventory rework. Three things in one
-- migration so the schema + data state move together:
--
--   1. NEW TABLE scaffolding_yards
--      Three placeholder yards seeded (Yard A / Yard B / Yard C).
--      Storekeeper renames them later through the UI.
--
--   2. NEW COLUMN inventory_movements.yard_id NULLABLE
--      Lets every movement record which internal warehouse yard
--      the stock sat in. NULL = legacy / unassigned (since this
--      migration soft-wipes existing rows the NULL bucket stays
--      empty for new movements). FK ON DELETE SET NULL so a yard
--      rename / archive doesn't orphan history.
--
--   3. SOFT WIPE of scaffolding_components + inventory_movements
--      Daksh: "soft-delete to keep history". Every existing
--      component goes is_active=FALSE so the catalog board reads
--      empty + the storekeeper starts adding fresh entries. Old
--      movements are soft-voided via a new is_voided column +
--      voided_at / voided_by, so the on-hand balances show as
--      zero everywhere (the stock view ignores voided rows) but
--      the rows themselves stay in the table for audit.
--
-- Read-only safety check passes: this migration does not DROP
-- any rows. Reversible by setting is_active = TRUE on components
-- + is_voided = FALSE on movements.

BEGIN;

-- ── 1. scaffolding_yards table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scaffolding_yards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- short id (YARD_A / YARD_B / YARD_C / custom)
  name          TEXT NOT NULL,                   -- display label
  notes         TEXT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS scaffolding_yards_active_idx
  ON public.scaffolding_yards (is_active, display_order)
  WHERE is_active = TRUE;

-- Seed the three placeholder yards. ON CONFLICT does nothing so the
-- migration is safely re-runnable + the storekeeper can rename them
-- from the UI without the seed clobbering their changes.
INSERT INTO public.scaffolding_yards (code, name, display_order) VALUES
  ('YARD_A', 'Yard A', 10),
  ('YARD_B', 'Yard B', 20),
  ('YARD_C', 'Yard C', 30)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.scaffolding_yards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scaffolding_yards_read_all ON public.scaffolding_yards;
CREATE POLICY scaffolding_yards_read_all
  ON public.scaffolding_yards FOR SELECT TO authenticated USING (TRUE);

-- ── 2. yard_id on inventory_movements ─────────────────────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS yard_id UUID NULL
    REFERENCES public.scaffolding_yards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_yard_idx
  ON public.inventory_movements (yard_id, created_at DESC)
  WHERE yard_id IS NOT NULL;

-- ── 3. Soft wipe ──────────────────────────────────────────────────
-- 3a. Soft-delete every existing component so the catalog reads empty.
UPDATE public.scaffolding_components
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE is_active = TRUE;

-- 3b. Add a soft-void flag on inventory_movements + stamp every
--     existing row with it. This makes the on-hand totals collapse
--     to zero across the board (the stock helper filters out voided
--     rows). History is preserved — voided rows stay queryable for
--     audit.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS is_voided  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS voided_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_active_idx
  ON public.inventory_movements (is_voided, created_at DESC)
  WHERE is_voided = FALSE;

UPDATE public.inventory_movements
   SET is_voided = TRUE,
       voided_at = NOW(),
       void_reason = 'mig_083_soft_wipe — start-fresh inventory rework (Daksh, Jun 2026)'
 WHERE is_voided = FALSE;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- The 3 placeholder yards.
--   SELECT code, name FROM scaffolding_yards ORDER BY display_order;
--
--   -- scaffolding_components: every row inactive.
--   SELECT is_active, COUNT(*) FROM scaffolding_components GROUP BY is_active;
--
--   -- inventory_movements: every row voided.
--   SELECT is_voided, COUNT(*) FROM inventory_movements GROUP BY is_voided;
--
--   -- yard_id column exists on inventory_movements.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'inventory_movements' AND column_name = 'yard_id';
-- ──────────────────────────────────────────────────────────────────
