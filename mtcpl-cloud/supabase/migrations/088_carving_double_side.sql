-- ──────────────────────────────────────────────────────────────────
-- Migration 088 — Double-side carving
-- ──────────────────────────────────────────────────────────────────
-- Daksh (June 2026): some slabs are carved on TWO sides (top + flip) —
-- twice the work. We tag each carving job with how many sides were
-- carved so the CNC costing (and the cockpit's carved-output stat)
-- counts a 2-side slab's CFT/SFT x2.
--
--   carving_sides = 1  → single side (default, all historical rows)
--   carving_sides = 2  → double side  → output counts x2
--
-- DEFAULT 1 means every existing row stays single-side, so all current
-- numbers are unchanged until a 2-side slab is assigned. The choice is
-- made at assign time and can be corrected later by staff at the
-- Carving Done Approval step (or on the carving job detail page).
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS carving_sides SMALLINT NOT NULL DEFAULT 1;

-- Domain guard: exactly 1 or 2. Wrapped in a DO block so the migration
-- is re-runnable (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carving_items_carving_sides_chk'
  ) THEN
    ALTER TABLE public.carving_items
      ADD CONSTRAINT carving_items_carving_sides_chk
      CHECK (carving_sides IN (1, 2));
  END IF;
END $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────
-- ALTER TABLE public.carving_items DROP CONSTRAINT IF EXISTS carving_items_carving_sides_chk;
-- ALTER TABLE public.carving_items DROP COLUMN IF EXISTS carving_sides;
