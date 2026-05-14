-- ──────────────────────────────────────────────────────────────────
-- Migration 032: cutter_edit_unlocked flag (replaces awaiting_cutter_edit)
--
-- Why
-- ───
-- Migration 027 modelled "auditor sends a bill back for cutter edit"
-- as a STATUS flip:
--   awaiting_approval  ⟶  awaiting_cutter_edit
-- This created two queue sections on the Cutting Audit page and made
-- the block "disappear" from the audit queue while the cutter was
-- fixing it.
--
-- Daksh asked for a different model:
--   • Blocks stay at `awaiting_approval` throughout.
--   • The cutter (team_head submitter) ALWAYS sees the block in
--     their queue, read-only by default.
--   • The auditor (dev / owner / approver) can flip a
--     `cutter_edit_unlocked` flag that lets the cutter edit.
--   • The cutter's save re-locks the flag automatically.
-- Same intent, less confusing surface — only ONE state to think
-- about, no section-shuffling.
--
-- Approach
-- ────────
-- Add the new boolean column. Migrate any rows currently sitting in
-- `awaiting_cutter_edit` back to `awaiting_approval` with the flag
-- set to TRUE (preserving the "cutter can edit this one" intent).
-- The `awaiting_cutter_edit` enum VALUE stays in the type — Postgres
-- doesn't easily allow removing enum values — but nothing in code
-- reads or writes it going forward.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS cutter_edit_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Roll any in-flight awaiting_cutter_edit rows into the new model.
-- sent_back_at / sent_back_by / sent_back_note are kept as-is —
-- they're now "when + who + why the cutter was given the unlock."
UPDATE public.cut_session_blocks
   SET status = 'awaiting_approval',
       cutter_edit_unlocked = TRUE,
       updated_at = NOW()
 WHERE status = 'awaiting_cutter_edit';

-- Partial index for the audit queue badge — covers the count query
-- and the per-row "is unlocked" filter.
CREATE INDEX IF NOT EXISTS cut_session_blocks_unlocked_idx
  ON public.cut_session_blocks (submitted_for_approval_at DESC)
  WHERE status = 'awaiting_approval' AND cutter_edit_unlocked = TRUE;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verify after running:
--
--   SELECT status, cutter_edit_unlocked, COUNT(*)
--     FROM public.cut_session_blocks
--    WHERE status IN ('awaiting_approval', 'awaiting_cutter_edit')
--    GROUP BY status, cutter_edit_unlocked;
--
-- Expected: zero rows with status='awaiting_cutter_edit'. All
-- previously-sent-back blocks are now awaiting_approval + unlocked.
-- ──────────────────────────────────────────────────────────────────
