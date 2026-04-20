-- Marble stone support: tonnage-based inventory + truck entries.
--
-- Sandstone flow is unchanged. Marble adds a new first-class entity
-- (marble_truck_entries) and two new optional columns on blocks
-- (tonnes, truck_entry_id). Block dimension columns become nullable
-- so marble blocks — which have no meaningful L×W×H — can exist.
--
-- User confirmed no real marble blocks exist yet, so the WhiteStone
-- → WhiteMarble rename runs safely.

BEGIN;

-- 1. Stone category column on stone_types. Existing stones default
--    to 'sandstone'; only WhiteStone gets reclassified to marble.
ALTER TABLE public.stone_types
  ADD COLUMN IF NOT EXISTS stone_category text
    NOT NULL DEFAULT 'sandstone'
    CHECK (stone_category IN ('sandstone', 'marble'));

-- 2. Rename WhiteStone → WhiteMarble and mark it marble.
UPDATE public.stone_types
  SET name = 'WhiteMarble', stone_category = 'marble'
  WHERE name = 'WhiteStone';

-- 3. Cascade the rename to any existing rows referencing WhiteStone.
UPDATE public.blocks
  SET stone = 'WhiteMarble'
  WHERE stone = 'WhiteStone';

UPDATE public.slab_requirements
  SET stone = 'WhiteMarble'
  WHERE stone = 'WhiteStone';

-- 4. Drop the legacy stone CHECK constraint (schema.sql has a stale
--    PinkStone/WhiteStone-only check; production may already have
--    none since RedStone is in active use). Idempotent.
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_stone_check;

-- 5. Marble blocks have no meaningful dimensions. Make the three
--    dimension columns nullable. Sandstone rows still have them
--    populated; the app layer enforces "sandstone requires dims,
--    marble requires tonnes".
ALTER TABLE public.blocks
  ALTER COLUMN length_ft DROP NOT NULL,
  ALTER COLUMN width_ft  DROP NOT NULL,
  ALTER COLUMN height_ft DROP NOT NULL;

-- 6. Tonnage column. Populated only on marble blocks.
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS tonnes NUMERIC(10, 3);

-- 7. First-class truck-entry entity. One row per incoming truck of
--    marble. Spawns N block rows whose tonnes = total_tonnes / N.
CREATE TABLE IF NOT EXISTS public.marble_truck_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stone TEXT NOT NULL,
  yard SMALLINT NOT NULL,
  truck_no TEXT,
  vendor_name TEXT,
  bill_no TEXT,
  total_tonnes NUMERIC(10, 3) NOT NULL CHECK (total_tonnes > 0),
  num_blocks SMALLINT NOT NULL CHECK (num_blocks > 0),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Link each marble block to its truck entry. ON DELETE SET NULL
--    so deleting a truck doesn't cascade-delete every block from it
--    (those would leave orphan slab references otherwise).
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS truck_entry_id UUID
    REFERENCES public.marble_truck_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS blocks_truck_entry_id_idx
  ON public.blocks(truck_entry_id)
  WHERE truck_entry_id IS NOT NULL;

-- 9. RLS on. App code uses createAdminSupabaseClient() which bypasses
--    RLS (same pattern as every other table). Policy shelf for later.
ALTER TABLE public.marble_truck_entries ENABLE ROW LEVEL SECURITY;

COMMIT;
