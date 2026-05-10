-- ──────────────────────────────────────────────────────────────────
-- Migration 020: stock_location on slab_requirements
--                + finish_block_cut() RPC accepts a stock location
--
-- Why: when the saw operator finishes cutting a block they need to
-- record WHERE the cut slabs are physically going (inside the
-- facility, a specific yard area, a vendor's truck, etc.) so the
-- carving team / dispatch team can find them later. Today there's
-- no place for that — the operator finishes Cutting Done and the
-- physical slabs effectively vanish until someone visually relocates
-- them.
--
-- This migration:
--   1. Adds slab_requirements.stock_location TEXT (nullable).
--   2. Drops + recreates finish_block_cut() with a new
--      `p_stock_location TEXT` parameter (default NULL for back-compat),
--      and applies that location to every slab the action touches:
--      cut_slab_ids, extra_slab_ids, transferred_slab_ids.
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Column add
ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS stock_location TEXT;

-- 2. Drop the old RPC — we're changing its parameter list, which
--    CREATE OR REPLACE can't do. The whole transaction wraps this so
--    if the recreate below fails the drop rolls back too.
DROP FUNCTION IF EXISTS public.finish_block_cut(
  UUID, UUID, TEXT, TEXT, INT, UUID,
  TEXT[], TEXT[], TEXT[], TEXT[], JSONB, BOOLEAN
);

-- 3. Recreate with the new p_stock_location parameter on the end.
CREATE OR REPLACE FUNCTION public.finish_block_cut(
  p_session_block_id UUID,
  p_session_id UUID,
  p_block_id TEXT,
  p_stone TEXT,
  p_yard INT,
  p_actor UUID,
  p_cut_slab_ids TEXT[],
  p_not_cut_slab_ids TEXT[],
  p_extra_slab_ids TEXT[],
  p_transferred_slab_ids TEXT[],
  p_remainders JSONB,
  p_restock BOOLEAN,
  p_stock_location TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_csb_status    TEXT;
  v_already_done  TEXT[] := ARRAY[]::TEXT[];
  v_pending_extra TEXT[];
  v_pending_xfer  TEXT[];
  v_restocked_ids TEXT[] := ARRAY[]::TEXT[];
  v_restocked_str TEXT;
  v_extras_count  INT;
  v_xfer_count    INT;
  v_donor_ids     UUID[];
  v_donor_blocks  TEXT[] := ARRAY[]::TEXT[];
  v_piece         JSONB;
  v_piece_id      TEXT;
  v_piece_l       NUMERIC;
  v_piece_w       NUMERIC;
  v_piece_h       NUMERIC;
  v_piece_quality TEXT;
  v_piece_yard    INT;
  v_loc           TEXT := NULLIF(TRIM(COALESCE(p_stock_location, '')), '');
BEGIN
  -- Idempotency: if already done, return immediately.
  SELECT status INTO v_csb_status
    FROM cut_session_blocks
    WHERE id = p_session_block_id;
  IF v_csb_status IS NULL THEN
    RAISE EXCEPTION 'Cut session block % not found', p_session_block_id;
  END IF;
  IF v_csb_status = 'done' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_done', true,
      'restocked_block_id', NULL,
      'transfer_donor_blocks', '[]'::jsonb
    );
  END IF;

  -- Pre-flight: figure out which extras/transfers were committed by
  -- a previous (timed-out) attempt — skip those on the retry so the
  -- race-guards below don't crash with "already taken".
  IF array_length(p_extra_slab_ids, 1) > 0 OR array_length(p_transferred_slab_ids, 1) > 0 THEN
    SELECT array_agg(id) INTO v_already_done
      FROM slab_requirements
      WHERE id = ANY(p_extra_slab_ids || p_transferred_slab_ids)
        AND status = 'cut_done'
        AND source_block_id = p_block_id;
  END IF;
  v_already_done := COALESCE(v_already_done, ARRAY[]::TEXT[]);

  v_pending_extra := COALESCE(
    ARRAY(SELECT unnest(p_extra_slab_ids) EXCEPT SELECT unnest(v_already_done)),
    ARRAY[]::TEXT[]
  );
  v_pending_xfer := COALESCE(
    ARRAY(SELECT unnest(p_transferred_slab_ids) EXCEPT SELECT unnest(v_already_done)),
    ARRAY[]::TEXT[]
  );

  -- ── Step 1: Remainder blocks ──────────────────────────────────
  IF p_restock AND p_remainders IS NOT NULL AND jsonb_array_length(p_remainders) > 0 THEN
    FOR v_piece IN SELECT * FROM jsonb_array_elements(p_remainders)
    LOOP
      v_piece_l := (v_piece->>'l')::NUMERIC;
      v_piece_w := (v_piece->>'w')::NUMERIC;
      v_piece_h := (v_piece->>'h')::NUMERIC;
      IF v_piece_l > 0 AND v_piece_w > 0 AND v_piece_h > 0 THEN
        v_piece_id := v_piece->>'id';
        v_piece_quality := v_piece->>'quality';
        v_piece_yard := COALESCE(NULLIF(v_piece->>'yard',''), p_yard::TEXT)::INT;

        -- Skip if a previous attempt already inserted (idempotent).
        IF NOT EXISTS (SELECT 1 FROM blocks WHERE id = v_piece_id) THEN
          INSERT INTO blocks (
            id, stone, yard, category,
            length_ft, width_ft, height_ft,
            quality, status, created_by, updated_by, created_at, updated_at
          ) VALUES (
            v_piece_id, p_stone, v_piece_yard, 'Reused',
            v_piece_l, v_piece_w, v_piece_h,
            CASE WHEN v_piece_quality IN ('A','B') THEN v_piece_quality ELSE NULL END,
            'available', p_actor, p_actor, v_now, v_now
          );
        END IF;
        v_restocked_ids := array_append(v_restocked_ids, v_piece_id);
      END IF;
    END LOOP;
  END IF;
  v_restocked_str := CASE WHEN array_length(v_restocked_ids, 1) > 0
                          THEN array_to_string(v_restocked_ids, ',')
                          ELSE NULL END;

  -- ── Step 2: Parent block → consumed ───────────────────────────
  UPDATE blocks
    SET status = 'consumed', updated_by = p_actor, updated_at = v_now
    WHERE id = p_block_id;

  -- ── Step 3: Cut slabs → cut_done (with optional stock_location) ──
  IF array_length(p_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done',
          stock_location = COALESCE(v_loc, stock_location),
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(p_cut_slab_ids);
  END IF;

  -- ── Step 4: Uncut slabs → open (clear stock_location too) ─────
  IF array_length(p_not_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'open',
          source_block_id = NULL,
          stock_location = NULL,
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(p_not_cut_slab_ids);
  END IF;

  -- ── Step 5: Extras → cut_done with this block as source ───────
  IF array_length(v_pending_extra, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done',
          source_block_id = p_block_id,
          stock_location = COALESCE(v_loc, stock_location),
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(v_pending_extra)
        AND status = 'open';

    GET DIAGNOSTICS v_extras_count = ROW_COUNT;
    IF v_extras_count <> array_length(v_pending_extra, 1) THEN
      RAISE EXCEPTION 'Some unplanned slabs (% of %) were already taken by another operation. Refresh and retry.',
        array_length(v_pending_extra, 1) - v_extras_count,
        array_length(v_pending_extra, 1);
    END IF;
  END IF;

  -- ── Step 6: Transfers from other blocks ───────────────────────
  IF array_length(v_pending_xfer, 1) > 0 THEN
    -- 6a. Validate every donor link: must be planned + on a donor
    -- block in pending_worker | pending_cut | cutting (NOT done).
    SELECT array_agg(DISTINCT csb.id), array_agg(DISTINCT csb.block_id)
      INTO v_donor_ids, v_donor_blocks
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(v_pending_xfer);

    IF (SELECT COUNT(*)
        FROM cut_session_slabs
        WHERE slab_requirement_id = ANY(v_pending_xfer)
       ) <> array_length(v_pending_xfer, 1)
    THEN
      RAISE EXCEPTION 'One or more transferred slabs are no longer planned anywhere — refresh and retry.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(v_pending_xfer)
        AND csb.status NOT IN ('pending_worker','pending_cut','cutting')
    ) THEN
      RAISE EXCEPTION 'A donor block is no longer in a transferable state (pending/cutting). Refresh and retry.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM cut_session_slabs
      WHERE slab_requirement_id = ANY(v_pending_xfer)
        AND cut_session_block_id = p_session_block_id
    ) THEN
      RAISE EXCEPTION 'Slab is already on this block — cannot transfer to itself.';
    END IF;

    -- 6b. Strip transferred slabs from each donor's layout.placed[].
    UPDATE cut_session_blocks csb
      SET layout = jsonb_set(
            csb.layout,
            '{placed}',
            COALESCE(
              (SELECT jsonb_agg(p)
               FROM jsonb_array_elements(csb.layout->'placed') p
               WHERE NOT (p->>'id' = ANY(v_pending_xfer))),
              '[]'::jsonb
            )
          ),
          needs_reprint = TRUE,
          reprint_reason = format(
            '%s slab(s) transferred to %s on %s: %s',
            (SELECT COUNT(*) FROM cut_session_slabs
              WHERE cut_session_block_id = csb.id
                AND slab_requirement_id = ANY(v_pending_xfer)),
            p_block_id,
            to_char(v_now, 'YYYY-MM-DD'),
            (SELECT string_agg(slab_requirement_id, ', ')
              FROM cut_session_slabs
              WHERE cut_session_block_id = csb.id
                AND slab_requirement_id = ANY(v_pending_xfer))
          ),
          updated_at = v_now
      WHERE csb.id = ANY(v_donor_ids);

    -- 6c. Delete donor's cut_session_slabs link rows for those slabs.
    DELETE FROM cut_session_slabs
      WHERE slab_requirement_id = ANY(v_pending_xfer)
        AND cut_session_block_id = ANY(v_donor_ids);

    -- 6d. Update transferred slab_requirements: planned → cut_done
    --     (also stamp stock_location).
    UPDATE slab_requirements
      SET status = 'cut_done',
          source_block_id = p_block_id,
          stock_location = COALESCE(v_loc, stock_location),
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(v_pending_xfer)
        AND status = 'planned';

    GET DIAGNOSTICS v_xfer_count = ROW_COUNT;
    IF v_xfer_count <> array_length(v_pending_xfer, 1) THEN
      RAISE EXCEPTION 'Some transferred slabs (% of %) were already cut or rejected by another operator. Refresh and retry.',
        array_length(v_pending_xfer, 1) - v_xfer_count,
        array_length(v_pending_xfer, 1);
    END IF;
  END IF;

  -- ── Step 7: Cut session block → done ──────────────────────────
  UPDATE cut_session_blocks
    SET status = 'done',
        restocked_block_id = v_restocked_str,
        cutting_seq = NULL,
        needs_reprint = FALSE,
        reprint_reason = NULL,
        updated_at = v_now
    WHERE id = p_session_block_id;

  -- ── Done. Return summary for the JS action's audit_log + notify.
  RETURN jsonb_build_object(
    'success', true,
    'already_done', false,
    'restocked_block_id', v_restocked_str,
    'restocked_count', COALESCE(array_length(v_restocked_ids, 1), 0),
    'extras_committed', COALESCE(array_length(v_pending_extra, 1), 0),
    'transfers_committed', COALESCE(array_length(v_pending_xfer, 1), 0),
    'transfer_donor_blocks', COALESCE(to_jsonb(v_donor_blocks), '[]'::jsonb),
    'transfer_donor_session_block_ids', COALESCE(to_jsonb(v_donor_ids), '[]'::jsonb),
    'stock_location', v_loc
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_block_cut(
  UUID, UUID, TEXT, TEXT, INT, UUID,
  TEXT[], TEXT[], TEXT[], TEXT[], JSONB, BOOLEAN, TEXT
) TO authenticated, service_role;

-- 4. PostgREST schema cache reload — without this, fresh callers
--    sometimes see "Could not find function ... in the schema cache".
NOTIFY pgrst, 'reload schema';

COMMIT;
