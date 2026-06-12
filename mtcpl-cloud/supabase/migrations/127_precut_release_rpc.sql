-- ──────────────────────────────────────────────────────────────────────
-- Migration 127 — precut_release_slabs RPC (extends mig 126 pre-cut)
-- ──────────────────────────────────────────────────────────────────────
-- Why:
--   Mig 126 let the office release a block's own PLANNED slabs early
--   ("pre-cut") while the block keeps cutting. Daksh now wants the same
--   early release to cover the two other things a Cutting-Done can pull
--   in:
--     • EXTRAS      — a slab cut from open inventory (status='open')
--     • TRANSFERS   — a slab claimed from ANOTHER block's plan
--                     (status='planned' on a different cut_session_block)
--   so the office can free those to carving immediately too, not only at
--   the final Cutting Done.
--
--   The transfer path mutates THREE tables (donor block layout +
--   needs_reprint, the donor's cut_session_slabs link rows, and the slab
--   itself). That MUST be atomic — a half-applied transfer would corrupt
--   the donor block's plan. Doing it from the TS action (multiple awaited
--   updates) cannot guarantee atomicity, so this migration adds a single
--   SECURITY DEFINER RPC that commits all three categories in one
--   transaction, mirroring the relevant steps of finish_block_cut but:
--     - it does NOT touch the parent block (still being cut),
--     - it does NOT close this cut_session_block (stays 'cutting'),
--     - it STAMPS precut_at / precut_by (mig 126) on every released slab,
--     - it bumps cut_session_blocks.precut_count / last_precut_at.
--
--   Idempotency with the eventual final Cutting Done is preserved because
--   finish_block_cut already EXCEPTs slabs that are already cut_done by
--   this same block (v_already_done) — so re-counting a pre-cut slab at
--   final Done is a no-op.
--
-- Safety:
--   Purely additive. No column/enum/data changes. New function only.
--   Rollback: DROP FUNCTION public.precut_release_slabs(UUID,TEXT,UUID,TEXT[],TEXT[],TEXT[],TEXT);
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.precut_release_slabs(
  p_session_block_id UUID,
  p_block_id TEXT,
  p_actor UUID,
  p_planned_slab_ids TEXT[],
  p_extra_slab_ids TEXT[],
  p_transferred_slab_ids TEXT[],
  p_stock_location TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_csb_status     TEXT;
  v_loc            TEXT := NULLIF(btrim(COALESCE(p_stock_location, '')), '');
  v_planned_count  INT := 0;
  v_extras_count   INT := 0;
  v_xfer_count     INT := 0;
  v_total          INT := 0;
  v_donor_ids      UUID[];
  v_donor_blocks   TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Guard: block must still be live-cutting. Pre-cut makes no sense
  -- once the cutter has submitted for audit (awaiting_approval) or the
  -- block is already done.
  SELECT status INTO v_csb_status
    FROM cut_session_blocks
    WHERE id = p_session_block_id;
  IF v_csb_status IS NULL THEN
    RAISE EXCEPTION 'Cut session block % not found', p_session_block_id;
  END IF;
  IF v_csb_status NOT IN ('cutting', 'done_prompt') THEN
    RAISE EXCEPTION 'Pre-cut is only available while the block is In Progress (cutting).';
  END IF;

  -- ── 1. PLANNED (this block) → cut_done ──────────────────────────
  -- Keep the cut_session_slabs link intact: the final finish_block_cut
  -- still lists these in cut_slab_ids (locked in the form) so Block
  -- Journey + efficiency math stay complete. Race-guard on status +
  -- precut_at so a double-submit can't release twice.
  IF COALESCE(array_length(p_planned_slab_ids, 1), 0) > 0 THEN
    -- Every id must actually belong to THIS block's plan.
    IF EXISTS (
      SELECT 1 FROM unnest(p_planned_slab_ids) AS t(sid)
      WHERE NOT EXISTS (
        SELECT 1 FROM cut_session_slabs
        WHERE cut_session_block_id = p_session_block_id
          AND slab_requirement_id = t.sid
      )
    ) THEN
      RAISE EXCEPTION 'A selected planned slab is not in this block''s plan. Refresh and retry.';
    END IF;

    UPDATE slab_requirements
      SET status = 'cut_done',
          cut_source_kind = 'planned',
          stock_location = COALESCE(v_loc, stock_location),
          precut_at = v_now,
          precut_by = p_actor,
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(p_planned_slab_ids)
        AND status = 'planned'
        AND precut_at IS NULL;
    GET DIAGNOSTICS v_planned_count = ROW_COUNT;
  END IF;

  -- ── 2. EXTRAS (open inventory) → cut_done, owned by this block ───
  IF COALESCE(array_length(p_extra_slab_ids, 1), 0) > 0 THEN
    -- Refuse if any already cut_done by a DIFFERENT block (double-claim).
    IF EXISTS (
      SELECT 1 FROM slab_requirements
      WHERE id = ANY(p_extra_slab_ids)
        AND status = 'cut_done'
        AND source_block_id IS DISTINCT FROM p_block_id
    ) THEN
      RAISE EXCEPTION 'One or more extra slabs were already cut by another block. Refresh and retry.';
    END IF;

    UPDATE slab_requirements
      SET status = 'cut_done',
          source_block_id = p_block_id,
          cut_source_kind = 'extra',
          stock_location = COALESCE(v_loc, stock_location),
          precut_at = v_now,
          precut_by = p_actor,
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(p_extra_slab_ids)
        AND status = 'open';
    GET DIAGNOSTICS v_extras_count = ROW_COUNT;
    IF v_extras_count <> array_length(p_extra_slab_ids, 1) THEN
      RAISE EXCEPTION 'Some extra slabs (% of %) were no longer open. Refresh and retry.',
        array_length(p_extra_slab_ids, 1) - v_extras_count,
        array_length(p_extra_slab_ids, 1);
    END IF;
  END IF;

  -- ── 3. TRANSFERS (other blocks' plans) → cut_done + donor reprint ─
  -- Mirrors finish_block_cut Step 6 exactly, minus closing this block.
  IF COALESCE(array_length(p_transferred_slab_ids, 1), 0) > 0 THEN
    -- All must still be planned somewhere.
    IF (SELECT COUNT(*) FROM cut_session_slabs
         WHERE slab_requirement_id = ANY(p_transferred_slab_ids))
       <> array_length(p_transferred_slab_ids, 1)
    THEN
      RAISE EXCEPTION 'One or more transferred slabs are no longer planned anywhere — refresh and retry.';
    END IF;

    -- Donor blocks must still be in a transferable state.
    IF EXISTS (
      SELECT 1
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(p_transferred_slab_ids)
        AND csb.status NOT IN ('pending_worker', 'pending_cut', 'cutting')
    ) THEN
      RAISE EXCEPTION 'A donor block is no longer in a transferable state (pending/cutting). Refresh and retry.';
    END IF;

    -- Not a self-transfer.
    IF EXISTS (
      SELECT 1 FROM cut_session_slabs
      WHERE slab_requirement_id = ANY(p_transferred_slab_ids)
        AND cut_session_block_id = p_session_block_id
    ) THEN
      RAISE EXCEPTION 'Slab is already on this block — cannot transfer to itself.';
    END IF;

    SELECT array_agg(DISTINCT csb.id), array_agg(DISTINCT csb.block_id)
      INTO v_donor_ids, v_donor_blocks
      FROM cut_session_slabs css
      JOIN cut_session_blocks csb ON csb.id = css.cut_session_block_id
      WHERE css.slab_requirement_id = ANY(p_transferred_slab_ids);

    -- Donor side: drop the slab from layout.placed, flag reprint.
    UPDATE cut_session_blocks csb
      SET layout = jsonb_set(
            csb.layout,
            '{placed}',
            COALESCE(
              (SELECT jsonb_agg(p)
                 FROM jsonb_array_elements(csb.layout->'placed') p
                WHERE NOT (p->>'id' = ANY(p_transferred_slab_ids))),
              '[]'::jsonb
            )
          ),
          needs_reprint = TRUE,
          reprint_reason = format(
            '%s slab(s) pre-cut/transferred to %s on %s: %s',
            (SELECT COUNT(*) FROM cut_session_slabs
               WHERE cut_session_block_id = csb.id
                 AND slab_requirement_id = ANY(p_transferred_slab_ids)),
            p_block_id,
            to_char(v_now, 'YYYY-MM-DD'),
            (SELECT string_agg(slab_requirement_id, ', ')
               FROM cut_session_slabs
              WHERE cut_session_block_id = csb.id
                AND slab_requirement_id = ANY(p_transferred_slab_ids))
          ),
          updated_at = v_now
      WHERE csb.id = ANY(v_donor_ids);

    -- Drop the donor link rows so the slab leaves the donor's plan.
    DELETE FROM cut_session_slabs
      WHERE slab_requirement_id = ANY(p_transferred_slab_ids)
        AND cut_session_block_id = ANY(v_donor_ids);

    -- Flip the slab into this block, stamped pre-cut.
    UPDATE slab_requirements
      SET status = 'cut_done',
          source_block_id = p_block_id,
          cut_source_kind = 'transferred',
          stock_location = COALESCE(v_loc, stock_location),
          precut_at = v_now,
          precut_by = p_actor,
          updated_by = p_actor,
          updated_at = v_now
      WHERE id = ANY(p_transferred_slab_ids)
        AND status = 'planned';
    GET DIAGNOSTICS v_xfer_count = ROW_COUNT;
    IF v_xfer_count <> array_length(p_transferred_slab_ids, 1) THEN
      RAISE EXCEPTION 'Some transferred slabs (% of %) were already cut or rejected by another operator. Refresh and retry.',
        array_length(p_transferred_slab_ids, 1) - v_xfer_count,
        array_length(p_transferred_slab_ids, 1);
    END IF;
  END IF;

  v_total := v_planned_count + v_extras_count + v_xfer_count;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nothing released — the selected slabs are no longer eligible (already pre-cut or moved on). Refresh and retry.';
  END IF;

  -- Bump the block's pre-cut counters (drives the In-Progress chip +
  -- the audit "PRE-CUT · N" badge). Block status is left untouched.
  UPDATE cut_session_blocks
    SET precut_count = COALESCE(precut_count, 0) + v_total,
        last_precut_at = v_now,
        updated_at = v_now
    WHERE id = p_session_block_id;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_total,
    'planned', v_planned_count,
    'extras', v_extras_count,
    'transfers', v_xfer_count,
    'donor_blocks', COALESCE(to_jsonb(v_donor_blocks), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.precut_release_slabs(
  UUID, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
