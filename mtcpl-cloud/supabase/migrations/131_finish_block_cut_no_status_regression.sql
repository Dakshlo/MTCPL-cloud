-- ──────────────────────────────────────────────────────────────────────
-- Migration 131 — finish_block_cut: never regress an advanced slab
-- ──────────────────────────────────────────────────────────────────────
-- Why:
--   PRE-CUT slabs (mig 126/127) are released to carving/dispatch while
--   their block is still cutting. Daksh now also direct-dispatches
--   pre-cut slabs (they can be on a truck before the block's final
--   Cutting-Done audit). But Step 3 of finish_block_cut flips EVERY
--   cut_slab_id back to 'cut_done' unconditionally — so the final
--   approval would clobber a slab that had already advanced
--   (carving_assigned / carving_in_progress / completed / dispatched),
--   dragging it back into the Unassigned pool while it's physically
--   gone. This adds a status guard so Step 3 only touches slabs that
--   haven't moved past the cut stage. Everything else is byte-identical
--   to the migration-035 revision (4th re-version of this RPC).
--
-- Safety: CREATE OR REPLACE only; no data touched at migration time.
-- Rollback: re-run migration 035's CREATE OR REPLACE (unguarded Step 3).
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

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
  p_restock BOOLEAN
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
BEGIN
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

  -- Step 1: Remainder blocks
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

  -- Step 2: Parent block → consumed
  UPDATE blocks
    SET status = 'consumed', updated_by = p_actor, updated_at = v_now
    WHERE id = p_block_id;

  -- Step 3: Cut slabs → cut_done (Migration 035: tag cut_source_kind)
  -- Migration 131: STATUS GUARD — only flip slabs still at the cut
  -- stage. A PRE-CUT slab that already advanced (assigned to carving,
  -- completed, direct-dispatched, on a truck) keeps its status; the
  -- final audit must never drag it back into the Unassigned pool.
  IF array_length(p_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done',
          cut_source_kind = 'planned',
          updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(p_cut_slab_ids)
        AND status IN ('planned', 'cutting', 'cut_done');
  END IF;

  -- Step 4: Uncut slabs → open
  IF array_length(p_not_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'open', source_block_id = NULL,
          cut_source_kind = NULL,
          updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(p_not_cut_slab_ids);
  END IF;

  -- Step 4b (Migration 034): drop stale link rows for not-cut slabs
  IF array_length(p_not_cut_slab_ids, 1) > 0 THEN
    DELETE FROM cut_session_slabs
      WHERE cut_session_block_id = p_session_block_id
        AND slab_requirement_id = ANY(p_not_cut_slab_ids);
  END IF;

  -- Step 5: Extras → cut_done (Migration 035: tag cut_source_kind='extra')
  IF array_length(v_pending_extra, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done', source_block_id = p_block_id,
          cut_source_kind = 'extra',
          updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(v_pending_extra)
        AND status = 'open';
    GET DIAGNOSTICS v_extras_count = ROW_COUNT;
    IF v_extras_count <> array_length(v_pending_extra, 1) THEN
      RAISE EXCEPTION 'Some unplanned slabs (% of %) were already taken by another operation. Refresh and retry.',
        array_length(v_pending_extra, 1) - v_extras_count,
        array_length(v_pending_extra, 1);
    END IF;
  END IF;

  -- Step 6: Transfers from other blocks
  IF array_length(v_pending_xfer, 1) > 0 THEN
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

    DELETE FROM cut_session_slabs
      WHERE slab_requirement_id = ANY(v_pending_xfer)
        AND cut_session_block_id = ANY(v_donor_ids);

    -- Step 6d (Migration 035: tag cut_source_kind='transferred')
    UPDATE slab_requirements
      SET status = 'cut_done', source_block_id = p_block_id,
          cut_source_kind = 'transferred',
          updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(v_pending_xfer)
        AND status = 'planned';

    GET DIAGNOSTICS v_xfer_count = ROW_COUNT;
    IF v_xfer_count <> array_length(v_pending_xfer, 1) THEN
      RAISE EXCEPTION 'Some transferred slabs (% of %) were already cut or rejected by another operator. Refresh and retry.',
        array_length(v_pending_xfer, 1) - v_xfer_count,
        array_length(v_pending_xfer, 1);
    END IF;
  END IF;

  -- Step 7: Cut session block → done
  UPDATE cut_session_blocks
    SET status = 'done',
        restocked_block_id = v_restocked_str,
        cutting_seq = NULL,
        needs_reprint = FALSE,
        reprint_reason = NULL,
        updated_at = v_now
    WHERE id = p_session_block_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_done', false,
    'restocked_block_id', v_restocked_str,
    'restocked_count', COALESCE(array_length(v_restocked_ids, 1), 0),
    'extras_committed', COALESCE(array_length(v_pending_extra, 1), 0),
    'transfers_committed', COALESCE(array_length(v_pending_xfer, 1), 0),
    'transfer_donor_blocks', COALESCE(to_jsonb(v_donor_blocks), '[]'::jsonb),
    'transfer_donor_session_block_ids', COALESCE(to_jsonb(v_donor_ids), '[]'::jsonb),
    'already_done_slab_ids', to_jsonb(v_already_done)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_block_cut(
  UUID, UUID, TEXT, TEXT, INT, UUID,
  TEXT[], TEXT[], TEXT[], TEXT[], JSONB, BOOLEAN
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
