-- ──────────────────────────────────────────────────────────────────
-- Migration 228: one shared tool store, not a crib per vendor
-- ──────────────────────────────────────────────────────────────────
-- Daksh, Oct 2026, after seeing 227 on screen:
--
--   "I don't want it like this. There is a COMMON STORE for all, but
--    they take from their own account. Manthan will take any tool and
--    it shows in his. But any item added shows for all — it is
--    available to everyone. And these CNC vendors' main point is NOT
--    to see what is in stock; they will just take from the store. So
--    there will be a master view for me or owner, and the vendor will
--    see all their recent items taken, and at the end an option to see
--    stock."
--
-- 227 gave every vendor their own catalogue and their own stock. That
-- was wrong about the plant: there is ONE store, and the vendors draw
-- from it. Adding "450mm tool" three times, once per vendor, is work
-- nobody should have to do, and three separate numbers for one shelf
-- is three chances to be wrong.
--
-- ── What changes ──────────────────────────────────────────────────
--
--   cnc_tools.vendor_id          DROPPED. A tool belongs to the store.
--   cnc_tool_movements.vendor_id NULLABLE, and its meaning changes:
--                                it is now WHO THE MOVEMENT IS FOR,
--                                not which crib it happened in.
--
--     issue  → vendor_id required. Stock leaves the store for them.
--     return → vendor_id required. It comes back from them.
--     receive / scrap / adjust → vendor_id NULL. Store-level; they
--                                belong to the store, not to a vendor.
--
-- Stock stays exactly what it was — SUM(delta) over the live rows —
-- except there is now one number per tool instead of one per vendor.
--
-- ── Taken means USED ──────────────────────────────────────────────
--
-- Daksh: "there is no return thing, they take the tool and it gets
-- used. Maybe sometimes they will take an item which may need to be
-- returned."
--
-- So a vendor's screen is a LOG of what they took, not a balance of
-- what they are holding, and nothing in the schema pretends to track
-- custody. `return` stays as an ordinary movement for the occasional
-- item that does come back — it simply puts stock back on the shelf
-- and says who brought it. No per-tool returnable/consumable flag:
-- that is setup work for a case that is rare by the owner's own
-- account, and the ledger handles it either way.
--
-- ── Safety: there IS live data ────────────────────────────────────
--
-- Daksh had already created a real tool before asking for this change
-- (450mm tool, 10 pcs, entered under MANTHAN's crib). Nothing of his is
-- dropped:
--
--   • The tool keeps its id, its name, its 10 pcs and its warn-at line.
--     It simply stops belonging to a crib and becomes a store tool,
--     which is what it always was in the yard.
--   • Its opening-stock line was recorded against MANTHAN only because
--     227 made vendor_id mandatory. Stock arriving on the shelf is a
--     STORE event, so the back-fill below nulls the vendor on every
--     receive/scrap/adjust. No delta is touched, so no stock figure
--     moves: 10 pcs before, 10 pcs after.
--
-- issue/return rows keep their vendor — that is the one place the
-- column still means something, and 227 made it NOT NULL so none can
-- be missing one.
--
-- The guards from 227 that still apply are kept; the cross-crib
-- composite FK goes, because there are no cribs left to cross.
--
-- Rollback:
--   see 227 — drop both tables and re-run it.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. The catalogue belongs to the store ─────────────────────────
-- The composite FK and the per-vendor unique index both exist only to
-- keep cribs apart, so both go with the column.
ALTER TABLE public.cnc_tool_movements
  DROP CONSTRAINT IF EXISTS cnc_tool_movements_same_vendor;

DROP INDEX IF EXISTS public.cnc_tools_id_vendor_idx;
DROP INDEX IF EXISTS public.cnc_tools_unique_per_vendor_idx;
DROP INDEX IF EXISTS public.cnc_tools_vendor_active_idx;

ALTER TABLE public.cnc_tools DROP COLUMN IF EXISTS vendor_id;

-- One shelf, one entry per tool. Trimmed + lowercased so "450MM Tool"
-- and "450mm tool " collide the way a person would expect.
CREATE UNIQUE INDEX IF NOT EXISTS cnc_tools_unique_name_idx
  ON public.cnc_tools (lower(trim(name)), lower(coalesce(trim(spec), '')));

CREATE INDEX IF NOT EXISTS cnc_tools_active_idx
  ON public.cnc_tools (display_order, name)
  WHERE is_active;

COMMENT ON TABLE public.cnc_tools IS
  'Mig 228 - the shared CNC tool store. One catalogue for the whole plant; every CNC vendor draws from it. Stock is NOT here: it is SUM(delta) over cnc_tool_movements.';

-- ── 2. vendor_id becomes "who it is for" ──────────────────────────
ALTER TABLE public.cnc_tool_movements ALTER COLUMN vendor_id DROP NOT NULL;

COMMENT ON COLUMN public.cnc_tool_movements.vendor_id IS
  'Mig 228 - WHO the movement is for. Required on issue/return (stock leaving for, or coming back from, that vendor). NULL on receive/scrap/adjust, which belong to the store itself.';

-- Back-fill BEFORE the constraint: stock arriving on (or leaving) the
-- shelf belongs to the store, not to whichever crib 227 happened to
-- file it under. Only the attribution changes; `delta` is untouched, so
-- every stock figure is identical before and after.
UPDATE public.cnc_tool_movements
   SET vendor_id = NULL
 WHERE kind IN ('receive', 'scrap', 'adjust')
   AND vendor_id IS NOT NULL;

-- A take must say which vendor it is for AND who physically carried it
-- away; a store-level line must not pretend to belong to anybody.
ALTER TABLE public.cnc_tool_movements
  DROP CONSTRAINT IF EXISTS cnc_tool_movements_vendor_shape;
ALTER TABLE public.cnc_tool_movements
  ADD CONSTRAINT cnc_tool_movements_vendor_shape CHECK (
    (kind IN ('issue', 'return') AND vendor_id IS NOT NULL) OR
    (kind IN ('receive', 'scrap', 'adjust') AND vendor_id IS NULL)
  );

-- ── 3. Indexes for the two screens this now has ───────────────────
-- The vendor's own screen: "what have I taken lately".
DROP INDEX IF EXISTS public.cnc_tool_movements_vendor_recent_idx;
CREATE INDEX IF NOT EXISTS cnc_tool_movements_vendor_live_idx
  ON public.cnc_tool_movements (vendor_id, created_at DESC)
  WHERE vendor_id IS NOT NULL AND undone_at IS NULL;

-- The master view: the whole register, newest first, undone rows
-- included because they stay visible struck through.
CREATE INDEX IF NOT EXISTS cnc_tool_movements_recent_idx
  ON public.cnc_tool_movements (created_at DESC);

-- The self-filling name picker is now per vendor across one store.
DROP INDEX IF EXISTS public.cnc_tool_movements_taken_by_idx;
CREATE INDEX IF NOT EXISTS cnc_tool_movements_taken_by_idx
  ON public.cnc_tool_movements (vendor_id, taken_by, created_at DESC)
  WHERE taken_by IS NOT NULL AND undone_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verification (paste separately after running) ─────────────────
-- select column_name, is_nullable from information_schema.columns
--  where table_name = 'cnc_tool_movements' and column_name = 'vendor_id';
--
-- select conname from pg_constraint
--  where conrelid = 'public.cnc_tool_movements'::regclass order by conname;
--
-- -- both of these must FAIL:
-- --   kind='issue'   with vendor_id NULL
-- --   kind='receive' with a vendor_id set
