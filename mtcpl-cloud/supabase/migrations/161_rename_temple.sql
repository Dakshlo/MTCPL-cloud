-- 161 — Safe temple RENAME (name only; code_prefix stays locked).
--
-- The temple name is denormalised (copied as a string) onto many tables, so a
-- rename must cascade everywhere or the slabs/dispatches/challans keep the old
-- name and split off. This function does the whole rename in ONE transaction.
-- The code_prefix is NOT touched — slab IDs embed it, so it must stay locked.

CREATE OR REPLACE FUNCTION public.rename_temple(p_id uuid, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old text;
  v_new text := btrim(p_new);
BEGIN
  SELECT name INTO v_old FROM public.temples WHERE id = p_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Temple not found';
  END IF;
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'New name is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.temples WHERE lower(name) = lower(v_new) AND id <> p_id) THEN
    RAISE EXCEPTION 'Another temple already uses that name';
  END IF;
  IF v_new = v_old THEN
    RETURN; -- no-op
  END IF;

  -- The temples row itself.
  UPDATE public.temples SET name = v_new WHERE id = p_id;

  -- Every table that stores the temple NAME (not a FK). Each is idempotent.
  UPDATE public.slab_requirements      SET temple = v_new WHERE temple = v_old;
  UPDATE public.dispatches             SET temple = v_new WHERE temple = v_old;
  UPDATE public.challans               SET temple = v_new WHERE temple = v_old;
  UPDATE public.temple_component_images SET temple = v_new WHERE temple = v_old;
  UPDATE public.carving_work_orders    SET temple = v_new WHERE temple = v_old;
  UPDATE public.site_yards             SET temple = v_new WHERE temple = v_old;
  UPDATE public.slab_import_batches    SET temple = v_new WHERE temple = v_old;
END;
$$;
