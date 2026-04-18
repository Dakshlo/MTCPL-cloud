-- 002_slab_labels_table.sql
--
-- Reusable slab labels (temple components — e.g. "Main Hall Floor Panel",
-- "Pillar Base") for the slab entry form's dropdown. Populated as users
-- save labels via the "+ Add new label" button in the LabelSelect combobox.
--
-- Scoped globally (not per-temple) so the same component names can be
-- reused across temples. Read access for any authenticated user;
-- write access too so the add form can insert new labels without needing
-- admin-role calls.

CREATE TABLE IF NOT EXISTS public.slab_labels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.slab_labels ENABLE ROW LEVEL SECURITY;

-- Idempotent policy (re)creation
DROP POLICY IF EXISTS "slab_labels read"  ON public.slab_labels;
DROP POLICY IF EXISTS "slab_labels write" ON public.slab_labels;

CREATE POLICY "slab_labels read"  ON public.slab_labels
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "slab_labels write" ON public.slab_labels
  FOR ALL   USING (auth.role() = 'authenticated')
          WITH CHECK (auth.role() = 'authenticated');

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.slab_labels;
--   -- Any slabs whose `label` happens to match a row in slab_labels are
--   -- unaffected — label is stored as a plain TEXT on slab_requirements,
--   -- not a foreign key.
