-- Migration 093 — allow requires_cnc_axes = 3 ("3-axis only" slab tag)
-- (Daksh, June 2026)
--
-- WHAT / WHY
-- Mig 079 added carving_items.requires_cnc_axes with a CHECK that only
-- permitted NULL / 4 / 5 (because back then "3-axis" was the implicit
-- "Any CNC" default). Daksh now wants an EXPLICIT "3-axis only" tag so
-- a simple slab can be locked to a 3-axis machine and not tie up the
-- 4/5-axis fleet. This relaxes the CHECK to also allow 3.
--
--   requires_cnc_axes = NULL  → Any CNC (3/4/5) — unchanged default
--   requires_cnc_axes = 3     → must load on a 3-axis machine  (NEW)
--   requires_cnc_axes = 4     → must load on a 4-axis machine
--   requires_cnc_axes = 5     → must load on a 5-axis machine
--
-- cnc_machines.cnc_axes already allows (3,4,5) since mig 079, so no
-- change is needed there.
--
-- SAFETY: drops + re-adds one CHECK constraint only. Mutates no rows,
-- widens (never narrows) the allowed set, so every existing value
-- (NULL/4/5) still passes. Idempotent — the DO block drops whatever
-- the old constraint was named (Postgres auto-named the inline mig-079
-- CHECK), then re-adds the widened one under a known name.

BEGIN;

-- Drop the existing CHECK on carving_items.requires_cnc_axes, whatever
-- it is named (inline column CHECKs get an auto-generated name).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'carving_items'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%requires_cnc_axes%'
  LOOP
    EXECUTE format('ALTER TABLE public.carving_items DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- Re-add it widened to allow 3 as well. NULL still passes ("Any CNC").
ALTER TABLE public.carving_items
  ADD CONSTRAINT carving_items_requires_cnc_axes_check
  CHECK (requires_cnc_axes IS NULL OR requires_cnc_axes IN (3, 4, 5));

COMMIT;

-- ROLLBACK (manual):
--   ALTER TABLE public.carving_items
--     DROP CONSTRAINT IF EXISTS carving_items_requires_cnc_axes_check;
--   ALTER TABLE public.carving_items
--     ADD CONSTRAINT carving_items_requires_cnc_axes_check
--     CHECK (requires_cnc_axes IS NULL OR requires_cnc_axes IN (4, 5));
--   -- (only safe if no rows have requires_cnc_axes = 3 yet)
