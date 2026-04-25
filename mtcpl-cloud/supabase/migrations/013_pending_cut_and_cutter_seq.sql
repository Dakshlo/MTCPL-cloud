-- New cutting workflow tab: "Waiting to Cut" between "Pending Approval"
-- and "In Progress". Adds:
--
--   1. New enum value 'pending_cut' on cut_block_status — block has been
--      sent to the cutting list (approved by owner / planner) but the
--      operator hasn't physically started cutting yet.
--      Lifecycle: pending_worker → pending_cut → cutting → done.
--
--   2. cutting_seq INT column — a per-cutter sequence number assigned
--      when a block actually transitions into the 'cutting' state. Lets
--      operators say "block #5" verbally. Numbers are reused as blocks
--      finish (NULL'd on done/rejected), so #5 is stable for a single
--      block's cutting period but can be reassigned to a future block
--      after the previous one finishes.
--
-- Existing blocks keep their current statuses — no automatic flip from
-- 'cutting' to anything else. The new 'pending_cut' state only applies
-- to NEW transitions going forward.

BEGIN;

-- 1. Add the new enum value. Postgres enum extension is non-trivial in
--    transactions on some Postgres versions; the IF NOT EXISTS guard
--    makes this idempotent.
ALTER TYPE public.cut_block_status ADD VALUE IF NOT EXISTS 'pending_cut';

-- 2. Add the cutting sequence column. NULL = block isn't currently in
--    the 'cutting' state (or hasn't been since this migration applied).
ALTER TABLE public.cut_session_blocks
  ADD COLUMN IF NOT EXISTS cutting_seq INT;

-- Partial index — only index rows currently in cutting state. This is
-- the working set we constantly query "what numbers are in use right now".
CREATE INDEX IF NOT EXISTS cut_session_blocks_cutting_seq_idx
  ON public.cut_session_blocks(cutting_seq)
  WHERE status = 'cutting' AND cutting_seq IS NOT NULL;

COMMIT;
