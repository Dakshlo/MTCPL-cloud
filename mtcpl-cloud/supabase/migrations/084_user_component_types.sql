-- ──────────────────────────────────────────────────────────────────
-- Mig 084 — User-defined scaffolding component types
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh June 2026 — the Add Component form's Type dropdown had 12
-- hardcoded options baked into a Postgres enum
-- (scaffolding_component_type). Daksh: "in type you already listed
-- many type i want you to remove all and give button there add
-- component type." So the storekeeper now builds their own type
-- list from scratch.
--
-- Two changes:
--   1. NEW TABLE scaffolding_component_types — the user-managed
--      catalog of types. NO seed; the picker starts empty + the
--      storekeeper adds each type via a "+ Add component type"
--      button.
--   2. CONVERT scaffolding_components.component_type from the
--      enum to TEXT so it can hold arbitrary user-created type
--      slugs. The enum type itself is left defined (harmless) —
--      we just stop binding the column to it.
--
-- Safety:
--   • The enum→text cast is loss-free; every existing value
--     (including the mig-083 soft-deleted rows) keeps its string.
--   • We drop + re-create the (component_type, size_spec) unique
--     constraint around the type change so the index rebuild is
--     explicit.
--   • No rows are deleted.

BEGIN;

-- ── 1. scaffolding_component_types table ──────────────────────────
CREATE TABLE IF NOT EXISTS public.scaffolding_component_types (
  -- Slug used as the stored value on scaffolding_components.
  -- component_type. The server action derives it from the label
  -- (lowercase + non-alnum → "_") so it stays stable across label
  -- renames.
  value         TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT scaffolding_component_types_label_uniq UNIQUE (label),
  CONSTRAINT scaffolding_component_types_label_chk
    CHECK (length(trim(label)) > 0 AND length(label) <= 60)
);

CREATE INDEX IF NOT EXISTS scaffolding_component_types_active_idx
  ON public.scaffolding_component_types (is_active, display_order)
  WHERE is_active = TRUE;

ALTER TABLE public.scaffolding_component_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scaffolding_component_types_read_all ON public.scaffolding_component_types;
CREATE POLICY scaffolding_component_types_read_all
  ON public.scaffolding_component_types FOR SELECT TO authenticated USING (TRUE);

-- ── 2. Convert component_type enum → TEXT ─────────────────────────
-- Drop the composite unique constraint first (it indexes the
-- column we're about to retype), retype, then re-add it.
ALTER TABLE public.scaffolding_components
  DROP CONSTRAINT IF EXISTS scaffolding_components_type_spec_unique;

ALTER TABLE public.scaffolding_components
  ALTER COLUMN component_type TYPE TEXT USING component_type::text;

ALTER TABLE public.scaffolding_components
  ADD CONSTRAINT scaffolding_components_type_spec_unique
    UNIQUE (component_type, size_spec);

-- The partial active index referenced component_type too; Postgres
-- keeps it valid across the type change (text comparison semantics
-- match), so no rebuild needed. Re-asserting it is harmless:
CREATE INDEX IF NOT EXISTS scaffolding_components_active_idx
  ON public.scaffolding_components (is_active, component_type, display_order)
  WHERE is_active = TRUE;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- Empty — nobody's created a type yet.
--   SELECT COUNT(*) FROM scaffolding_component_types;
--
--   -- component_type is now text, not the enum.
--   SELECT data_type FROM information_schema.columns
--    WHERE table_name = 'scaffolding_components'
--      AND column_name = 'component_type';
--   -- expect: text
--
--   -- existing (soft-deleted) rows still carry their old values.
--   SELECT component_type, COUNT(*) FROM scaffolding_components
--    GROUP BY component_type ORDER BY COUNT(*) DESC LIMIT 20;
-- ──────────────────────────────────────────────────────────────────
