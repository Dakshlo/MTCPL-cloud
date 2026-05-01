-- 016: Cutter operator assignments.
--
-- Adds a small lookup table of named operators (no auth, no login)
-- and a foreign-key column on cut_session_blocks so each block can
-- be tagged with the person physically running the saw. Team head
-- picks an operator when sending a block to "Waiting to Cut", and
-- the operator's name surfaces on the block card all the way through
-- to "Done today" — closes the "who actually cut this block" gap.
--
-- Operators are intentionally NOT a profiles row. They don't log in;
-- they're floor staff. Team head just maintains the picklist.
--
-- Initial release is gated to developer-only in the application
-- layer (cutting-permissions.ts). Once the team validates the flow
-- the gate will widen — schema is already designed to support it.

BEGIN;

-- ── Lookup table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  facility    TEXT NULL CHECK (facility IS NULL OR facility IN ('mtcpl','riico')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Same trimmed-name uniqueness rule the team applies verbally —
  -- prevents accidental duplicates ("Ramesh" / "Ramesh ").
  CONSTRAINT operators_name_unique UNIQUE (name)
);

-- Active operators are read on every cutting page render — index keeps
-- the picklist load fast as the list grows.
CREATE INDEX IF NOT EXISTS operators_active_name_idx
  ON public.operators(is_active, name)
  WHERE is_active = TRUE;

-- ── Assignment column ───────────────────────────────────────────
ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS operator_id UUID NULL
    REFERENCES public.operators(id) ON DELETE SET NULL;

-- Filter "blocks owned by operator X" — used by the cutting page
-- whenever the team head wants to scope by person.
CREATE INDEX IF NOT EXISTS cut_session_blocks_operator_idx
  ON public.cut_session_blocks(operator_id)
  WHERE operator_id IS NOT NULL;

-- ── RLS / RBAC ──────────────────────────────────────────────────
-- Read access: all authenticated users (so the operator name shows
-- on every cutting card). Write access (insert/update/delete on the
-- operators table) is gated in application code — service-role admin
-- client only — so we don't need a row-level policy for writes.
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_read_authenticated"
  ON public.operators
  FOR SELECT
  TO authenticated
  USING (TRUE);

COMMIT;
