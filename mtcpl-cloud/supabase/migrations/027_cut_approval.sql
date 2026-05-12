-- ──────────────────────────────────────────────────────────────────
-- Migration 027: cut approval — supervisor checkpoint between
-- Cutting Done and Done Today.
--
-- Why
-- ───
-- Cutter operators sometimes make data-entry mistakes on the
-- Cutting Done form — wrong slab marked cut, wrong extra from open
-- inventory, accidental transfer claim from another block. Today
-- those mistakes commit immediately (slab statuses flip, donor
-- needs_reprint sets, audit logs record the wrong entry).
--
-- This migration adds a human review step: a small set of approvers
-- (developer, owner, and team_head Rajesh Kumar only) review every
-- Cutting Done submission. They can approve as-is, edit-in-place
-- and approve, or send back to the cutter to fix.
--
-- Approach
-- ────────
-- - Two new cut_block_status values: 'awaiting_approval' and
--   'awaiting_cutter_edit'.
-- - The cutter's payload sits on cut_session_blocks.pending_approval_payload
--   (JSONB) until approval. NO downstream mutations until approve.
-- - On approve, the existing finish_block_cut RPC (migration 018)
--   fires from the staged payload — atomic commit.
--
-- No data migration. Existing rows with status='cutting'/'done'/etc
-- stay exactly where they are. New behaviour kicks in for future
-- finishBlockAction calls only.
--
-- The ALTER TYPE ADD VALUE statements cannot run inside a
-- transaction — they live above the BEGIN/COMMIT block.
-- ──────────────────────────────────────────────────────────────────

ALTER TYPE public.cut_block_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
ALTER TYPE public.cut_block_status ADD VALUE IF NOT EXISTS 'awaiting_cutter_edit';

BEGIN;

-- Per-profile approver flag. Set Rajesh's row to TRUE after
-- running. Developer + Owner roles always qualify in code,
-- regardless of this bit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_approve_cuts BOOLEAN NOT NULL DEFAULT FALSE;

-- Approval bookkeeping on cut_session_blocks.
--   pending_approval_payload — JSONB snapshot of the cutter's
--     Cutting Done form: cut_slab_ids, not_cut_slab_ids,
--     extra_slab_ids, transferred_slab_ids, remainders, restock,
--     stock_location. Replaced on every edit. NULL once approved.
--   submitted_for_approval_*  — first submission tracking.
--   approved_*                — approval tracking.
--   approval_edited_*         — last edit (approver or cutter)
--     while in approval flow.
--   sent_back_*               — set when approver clicks
--     "Send back for edit"; cleared when cutter resubmits.
ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS pending_approval_payload JSONB,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_edited_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_back_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_back_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_back_note TEXT;

-- Speeds up the "pending approvals" count in the top-bar badge +
-- the approvals page list.
CREATE INDEX IF NOT EXISTS cut_session_blocks_awaiting_approval_idx
  ON public.cut_session_blocks (submitted_for_approval_at DESC)
  WHERE status IN ('awaiting_approval', 'awaiting_cutter_edit');

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration manual step (paste separately after running):
--
--   UPDATE public.profiles
--      SET can_approve_cuts = TRUE
--    WHERE full_name ILIKE 'RAJESH KUMAR%';
--
-- Other future approvers: same pattern, flip the bit.
-- ──────────────────────────────────────────────────────────────────
