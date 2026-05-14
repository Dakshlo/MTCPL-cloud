-- ──────────────────────────────────────────────────────────────────────
-- Migration 034 — finish_block_cut() also deletes not-cut link rows
-- ──────────────────────────────────────────────────────────────────────
-- Bug it fixes:
--   When a cut_session_block finishes, the existing RPC (migration 018)
--   correctly:
--     - flips not-cut slabs back to status='open' on slab_requirements
--     - deletes cut_session_slabs link rows for transferred-OUT slabs
--   But it FORGETS to delete cut_session_slabs link rows for the
--   NOT-CUT slabs. Those rows linger forever, pointing to a done csb.
--
--   The downstream effect surfaced via the
--   "Donor block(s) [MT-B-100] are no longer pending" approval error:
--   ASTA-0004-13 had a stale link to MT-B-100 (which had finished, with
--   that slab marked not-cut), AND a live link to MT-B-269 (where it
--   was later re-planned). When MT-B-248 tried to claim it as a
--   transfer, approveCutAction's pre-flight saw both link rows and
--   refused because MT-B-100 wasn't in a transferable state.
--
-- The fix:
--   Add a "Step 4b" after the not-cut slab_requirements update that
--   ALSO deletes the corresponding cut_session_slabs rows. Symmetric
--   to the Step 6c delete for transferred-out slabs.
--
-- This migration also lays out the rule of thumb for what survives
-- on a done block's cut_session_slabs:
--   - Cut slabs              → KEPT (historical "what was cut here")
--   - Not-cut slabs          → DELETED (slab returned to open inventory)
--   - Transferred-out slabs  → DELETED (slab moved to claimer)
--   - Extras                 → never had a row to begin with
--
-- Idempotent: CREATE OR REPLACE FUNCTION, deploys via a single call.
-- No data migration needed — the existing stale rows for ASTA-0004-13
-- were already cleaned up manually, and a system-wide sweep is
-- offered separately at the application level if Daksh wants it.
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

  -- ── Step 3: Cut slabs → cut_done ──────────────────────────────
  -- Their cut_session_slabs link rows STAY — they're the historical
  -- record of what was placed and cut on this block's layout.
  IF array_length(p_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done', updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(p_cut_slab_ids);
  END IF;

  -- ── Step 4: Uncut slabs → open ────────────────────────────────
  IF array_length(p_not_cut_slab_ids, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'open', source_block_id = NULL,
          updated_by = p_actor, updated_at = v_now
      WHERE id = ANY(p_not_cut_slab_ids);
  END IF;

  -- ── Step 4b: Delete cut_session_slabs links for not-cut slabs ──
  -- Migration 034 — this is the fix. The slab has returned to 'open'
  -- inventory and may be re-planned on a different block. If we leave
  -- this link row pointing at a 'done' csb, any future transfer claim
  -- of the slab from its new home block will fail the
  -- approveCutAction pre-flight ("donor block is no longer pending"),
  -- because the lookup will find the stale row on this done block.
  --
  -- Restricted to THIS session block's rows so we don't accidentally
  -- nuke link rows on other blocks that legitimately have the same
  -- slab earmarked or planned. (PostgREST/app code keeps this scoped
  -- already, but the WHERE clause is the belt-and-braces version.)
  IF array_length(p_not_cut_slab_ids, 1) > 0 THEN
    DELETE FROM cut_session_slabs
      WHERE cut_session_block_id = p_session_block_id
        AND slab_requirement_id = ANY(p_not_cut_slab_ids);
  END IF;

  -- ── Step 5: Extras → cut_done with this block as source ───────
  IF array_length(v_pending_extra, 1) > 0 THEN
    UPDATE slab_requirements
      SET status = 'cut_done', source_block_id = p_block_id,
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

  -- ── Step 6: Transfers from other blocks ───────────────────────
  IF array_length(v_pending_xfer, 1) > 0 THEN
    -- 6a. Validate every donor link: must be planned + on a donor
    -- block in pending_worker | pending_cut | cutting (NOT done).
    -- Also collect donor session_block ids + their physical block ids.
    SELECT array_agg(DISTINCT csb.id), array_agg(DISTINCT csb.block_id)
      INTO v_donor_ids, v_donor_blocks
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(v_pending_xfer);

    -- Check we have one link per pending xfer slab.
    IF (SELECT COUNT(*)
        FROM cut_session_slabs
        WHERE slab_requirement_id = ANY(v_pending_xfer)
       ) <> array_length(v_pending_xfer, 1)
    THEN
      RAISE EXCEPTION 'One or more transferred slabs are no longer planned anywhere — refresh and retry.';
    END IF;

    -- Check donor states are all valid.
    IF EXISTS (
      SELECT 1
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(v_pending_xfer)
        AND csb.status NOT IN ('pending_worker','pending_cut','cutting')
    ) THEN
      RAISE EXCEPTION 'A donor block is no longer in a transferable state (pending/cutting). Refresh and retry.';
    END IF;

    -- Disallow self-transfer.
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
    UPDATE slab_requirements
      SET status = 'cut_done', source_block_id = p_block_id,
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
    'already_done_slab_ids', to_jsonb(v_already_done)
  );
END;
$$;

-- Re-grant (CREATE OR REPLACE preserves existing grants, but it's
-- cheap insurance and matches the convention from migration 018.)
GRANT EXECUTE ON FUNCTION public.finish_block_cut(
  UUID, UUID, TEXT, TEXT, INT, UUID,
  TEXT[], TEXT[], TEXT[], TEXT[], JSONB, BOOLEAN
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
