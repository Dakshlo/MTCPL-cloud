-- ──────────────────────────────────────────────────────────────────────
-- Migration 033 — Pending-transfer earmark on donor slabs
-- ──────────────────────────────────────────────────────────────────────
-- Closes a gap exposed by the "Donor block(s) [MT-B-100] are no longer
-- pending — the transfer cannot be committed." failure mode.
--
-- Background. When a team_head submits "Cutting Done" with a slab
-- claimed from another block's plan (the "transfer" feature), the
-- submission only stages a payload on the SUBMITTER side
-- (cut_session_blocks.pending_approval_payload). The DONOR side was
-- untouched until approval. That left a race window:
--
--     submission  ─────────────────── approval (RPC commits transfer)
--                  ↑
--                  Donor was free to finish its own cut here. When
--                  that happened, the slab was no longer in a
--                  transferable state, and approval blew up.
--
-- New model. At submission time we EARMARK the donor's
-- cut_session_slabs row with `pending_transfer_to_csb_id` pointing
-- back at the awaiting-approval block. That earmark is the
-- "temporary storage" Daksh asked for — the claim is reserved on
-- the donor row but the slab is still planned, not committed.
--
-- The companion code in src/app/(app)/cutting/actions.ts:
--   • finishBlockAction stamps the earmark + flips donor.needs_reprint
--     = TRUE with a "claimed pending audit of X" reason so the donor's
--     operator sees the banner on every cutting view they hit.
--   • finishBlockAction refuses if any of THIS block's slabs is itself
--     earmarked (i.e. someone else already claimed something — don't
--     let me close the block out under them).
--   • editPendingApprovalAction diffs OLD vs NEW transferred_slab_ids
--     and updates earmarks accordingly when the approver / cutter edits
--     the staged payload.
--   • The finish_block_cut RPC (migration 018) deletes donor rows as
--     part of the commit, so earmarks are naturally released.
--
-- RLS. cut_session_slabs already has its read-only-for-authenticated
-- policy from migration 029. The new column is column-level free;
-- no policy change needed. All writes go through the admin client.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- IMPORTANT: this column is intentionally NOT a foreign key.
--
-- We initially declared `REFERENCES public.cut_session_blocks(id) ON
-- DELETE SET NULL` here, which broke /cutting in production: PostgREST
-- saw TWO FKs from cut_session_slabs to cut_session_blocks
-- (cut_session_block_id and pending_transfer_to_csb_id), and refused
-- to resolve the existing `cut_session_slabs(...)` embed used by
-- /cutting, /cutting/[id], the print pages, and a couple of server
-- actions. The error surfaced as the generic "A server error
-- occurred" page on /cutting.
--
-- We could disambiguate every embed with PostgREST's `!fk_column`
-- hint, but that touches half a dozen queries spread across server
-- components and is fragile (every new query a future developer adds
-- would need the same hint). A plain UUID is simpler:
--   • All writes go through application code that already validates
--     the target cut_session_blocks row exists.
--   • cut_session_blocks rows are never hard-deleted in this app
--     (rejected blocks live as status='rejected'), so ON DELETE
--     SET NULL would never have fired anyway.
--
-- If you ever DO want the FK back, give it a non-default constraint
-- name and disambiguate every cut_session_slabs/cut_session_blocks
-- embed first. The relevant queries to update at that time:
--   src/app/(app)/cutting/page.tsx
--   src/app/(app)/cutting/[id]/page.tsx
--   src/app/(print)/cutting/[id]/print/page.tsx
--   src/app/(print)/cutting/list-print/page.tsx
--   src/app/(app)/cutting/actions.ts (applyTransferEarmarks + approveCutAction)
ALTER TABLE public.cut_session_slabs
  ADD COLUMN IF NOT EXISTS pending_transfer_to_csb_id UUID NULL;

-- Partial index — the column is NULL on the overwhelming majority of
-- rows, so a partial index gives us fast "is this slab earmarked?" /
-- "what does this awaiting-approval block claim?" lookups for free.
CREATE INDEX IF NOT EXISTS cut_session_slabs_pending_xfer_idx
  ON public.cut_session_slabs (pending_transfer_to_csb_id)
  WHERE pending_transfer_to_csb_id IS NOT NULL;

-- One-time backfill. Any cut_session_block that is currently
-- awaiting_approval with transferred_slab_ids in its payload should
-- have its donor rows earmarked, otherwise the new finishBlockAction
-- guard ("refuse if my slab is earmarked") would let racing donors
-- through for blocks submitted before this migration.
--
-- We only stamp where:
--   1. The donor cut_session_slabs row still exists (donor wasn't
--      already approved/finished — those are the broken-state rows
--      that need the manual edit escape hatch anyway).
--   2. The donor cut_session_block is in a status we still treat as
--      mutable.
--   3. No other earmark is already in place (no double-claims).
--
-- Anything that fails the WHERE silently — that's the pre-existing
-- broken-state that the approver has to clear via "Edit" / "Allow
-- cutter to edit". This migration doesn't fix history, it just stops
-- the bleeding for new submissions.
DO $$
DECLARE
  csb RECORD;
  slab_id TEXT;
BEGIN
  FOR csb IN
    SELECT id, block_id, pending_approval_payload
      FROM public.cut_session_blocks
     WHERE status = 'awaiting_approval'
       AND pending_approval_payload IS NOT NULL
       AND jsonb_array_length(
             COALESCE(pending_approval_payload->'transferred_slab_ids', '[]'::jsonb)
           ) > 0
  LOOP
    FOR slab_id IN
      SELECT jsonb_array_elements_text(csb.pending_approval_payload->'transferred_slab_ids')
    LOOP
      UPDATE public.cut_session_slabs css
         SET pending_transfer_to_csb_id = csb.id
       WHERE css.slab_requirement_id = slab_id
         AND css.cut_session_block_id <> csb.id
         AND css.pending_transfer_to_csb_id IS NULL
         AND EXISTS (
           SELECT 1
             FROM public.cut_session_blocks d
            WHERE d.id = css.cut_session_block_id
              AND d.status IN (
                'pending_worker','pending_cut','cutting','done_prompt',
                'awaiting_approval','awaiting_cutter_edit'
              )
         );
    END LOOP;
  END LOOP;
END$$;

-- Reload PostgREST schema cache so the new column is visible to
-- the admin client immediately (matches the convention from
-- migrations 027/028/032).
NOTIFY pgrst, 'reload schema';

COMMIT;
