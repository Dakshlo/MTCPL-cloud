-- ──────────────────────────────────────────────────────────────────
-- Migration 062: bills.block_cft — volume captured on raw-stone bills
-- ──────────────────────────────────────────────────────────────────
-- Mig 061 introduced canonical bill-vendor categories. The five
-- Block Purchase sub-types (pinkstone / marble / yellowmarble /
-- redstone / other-block) cover the raw-stone spend. For those
-- bills Daksh's dad wants to capture the CFT (cubic feet of stone
-- volume bought on the bill) so he can later compute ₹ per CFT
-- per stone type.
--
-- Nullable — every other category (equipment / jobwork / transport
-- / repair / other) doesn't carry a meaningful CFT, and legacy bills
-- predate the field. CHECK constraint allows zero / null / positive
-- only.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS block_cft NUMERIC(14, 3) NULL
    CHECK (block_cft IS NULL OR block_cft >= 0);

-- No index needed yet — the column is for display + future per-stone
-- cost rollups; nothing filters on it directly.

NOTIFY pgrst, 'reload schema';

COMMIT;
