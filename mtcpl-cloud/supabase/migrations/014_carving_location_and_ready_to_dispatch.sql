-- 014: Add location + ready_to_dispatch tracking to carving_items.
--
-- New flow for approved carving jobs:
--   1. Vendor marks complete   → completed_at set        (Awaiting Review)
--   2. Team approves            → review_approved_at set  (Carving Done)
--   3. Team enters location +
--      clicks "Ready to Dispatch" → ready_to_dispatch_at set
--      → slab_requirements.status = 'completed'
--      → slab now appears in Dispatch Station "Ready" tab
--   4. Dispatch station packs   → dispatch_logs row + slab.status='dispatched'
--
-- Previously step 3 didn't exist — approved slabs jumped straight to
-- dispatched via a "Mark Dispatched" button on the carving detail page,
-- skipping the dispatch station entirely. The new column lets the team
-- record where the carved slab is physically (could be outside the
-- facility — at a vendor's yard, in transit, etc.) before dispatch.

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS location              TEXT,
  ADD COLUMN IF NOT EXISTS ready_to_dispatch_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_to_dispatch_by  UUID REFERENCES auth.users(id);

-- Partial index for the dashboard "ready to dispatch" query.
CREATE INDEX IF NOT EXISTS carving_items_ready_to_dispatch_idx
  ON public.carving_items(ready_to_dispatch_at DESC)
  WHERE ready_to_dispatch_at IS NOT NULL;

-- Backfill: any approved-but-not-yet-dispatched job from the old flow
-- gets implicitly marked ready_to_dispatch_at = review_approved_at so
-- nothing falls through the cracks. Already-dispatched jobs are
-- skipped (status='dispatched').
UPDATE public.carving_items
   SET ready_to_dispatch_at = review_approved_at,
       ready_to_dispatch_by = review_approved_by
 WHERE review_approved_at IS NOT NULL
   AND status <> 'dispatched'
   AND ready_to_dispatch_at IS NULL;

COMMIT;
