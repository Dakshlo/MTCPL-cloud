-- ──────────────────────────────────────────────────────────────────
-- 140 — One-off DATA FIX (Daksh, June 2026)
--
-- OMKARESHWAR TEMPLE was created with code_prefix "0M" (digit ZERO + M)
-- instead of "OM" (letter O + M). Every slab code for this temple is
-- therefore "0M-NNNN" and should be "OM-NNNN".
--
-- The slab code IS the slab_requirements primary key, embedded across the
-- whole system, so this rewrites it EVERYWHERE the code lives:
--   • temples.code_prefix                        '0M'      -> 'OM'
--   • slab_requirements.id (PK)                  '0M-NNNN' -> 'OM-NNNN'
--   • all 5 FK children (cut sessions, carving items incl. carving-done,
--     dispatch logs, work-order items, challan items)
--   • slab_requirements.replacement_slab_id / replacement_of (self-refs,
--     plain text, no FK)
--   • cut_session_blocks.pending_approval_payload (slab codes embedded as
--     JSON, for any cut batch still awaiting approval)
--
-- The FK constraints are NOT declared ON UPDATE CASCADE (and are not
-- DEFERRABLE), so a plain UPDATE of the PK would raise a foreign-key
-- violation. We therefore DROP each FK, rewrite parent + children, then
-- RE-ADD each FK with its EXACT original definition (preserving ON DELETE).
-- Everything runs inside a single atomic DO block — any error rolls the
-- whole thing back, leaving the data untouched.
--
-- Idempotent: re-running finds no "0M-" rows and is a no-op (the FKs are
-- simply dropped and recreated unchanged). Blocks are NOT touched — only
-- slab codes use this temple's prefix.
-- ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fk            RECORD;
  recreate_cmds TEXT[] := ARRAY[]::TEXT[];
  cmd           TEXT;
BEGIN
  -- 1. For every FK that references public.slab_requirements: remember how to
  --    rebuild it, drop it, then rewrite that child's code column. While the
  --    FK is dropped the temporary parent/child mismatch is allowed.
  FOR fk IN
    SELECT con.conname,
           cl.relname AS child_table,
           (SELECT a.attname
              FROM pg_attribute a
             WHERE a.attrelid = con.conrelid
               AND a.attnum = con.conkey[1]) AS child_col,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class cl     ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_class refcl  ON refcl.oid = con.confrelid
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND refcl.relname = 'slab_requirements'
  LOOP
    recreate_cmds := recreate_cmds
      || format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
                fk.child_table, fk.conname, fk.def);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
                   fk.child_table, fk.conname);
    EXECUTE format(
      'UPDATE public.%I SET %I = ''OM'' || substring(%I from 3) WHERE %I LIKE ''0M-%%''',
      fk.child_table, fk.child_col, fk.child_col, fk.child_col);
  END LOOP;

  -- 2. The slab codes themselves (the primary key).
  UPDATE public.slab_requirements
     SET id = 'OM' || substring(id from 3)
   WHERE id LIKE '0M-%';

  -- 3. Self-referencing slab-code columns (plain text, no FK).
  UPDATE public.slab_requirements
     SET replacement_slab_id = 'OM' || substring(replacement_slab_id from 3)
   WHERE replacement_slab_id LIKE '0M-%';
  UPDATE public.slab_requirements
     SET replacement_of = 'OM' || substring(replacement_of from 3)
   WHERE replacement_of LIKE '0M-%';

  -- 4. The temple's code prefix.
  UPDATE public.temples SET code_prefix = 'OM' WHERE code_prefix = '0M';

  -- 5. Defensive: a still-pending cut-approval payload can embed slab codes
  --    as JSON string values ("0M-0001"); rewrite those too.
  UPDATE public.cut_session_blocks
     SET pending_approval_payload =
           replace(pending_approval_payload::text, '"0M-', '"OM-')::jsonb
   WHERE pending_approval_payload::text LIKE '%"0M-%';

  -- 6. Recreate every FK exactly as it was (preserves ON DELETE behaviour).
  FOREACH cmd IN ARRAY recreate_cmds LOOP
    EXECUTE cmd;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
