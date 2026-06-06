-- ──────────────────────────────────────────────────────────────────
-- Migration 097: "Depart" hold + Outsource "Still Pending Work"
--
-- Two new approval-stage concepts (Daksh June 2026):
--
-- 1. DEPART — at Approve sign-off (CNC + Outsource) the reviewer can
--    tick "Depart": the slab IS approved (goes to Carving Done) but is
--    held OUT of dispatch because it needs a finishing touch first.
--    Mandatory photo (reuses the approval photo) + a note.
--      • carving_items.depart_flag / depart_note / depart_at / depart_by
--      • carving_items.depart_cleared_at / depart_cleared_by — stamped
--        when Dispatch's "✓ Correct" button releases the hold.
--      • slab_requirements.dispatch_hold — the dispatch page filters on
--        this so departed slabs sit in a separate "Needs work" section
--        instead of "Make Dispatch".
--
-- 2. STILL PENDING WORK — Outsource approval replaces Rework + Reject
--    with a single "Still Pending Work" action. The slab stays received
--    (completed_at set, review_approved_at NULL) but leaves the Carving
--    Done Approval queue into a vendor-wise "Still Pending Work" tab.
--    A "Back to approval" button clears it so it can be approved later.
--      • carving_items.pending_work_at / pending_work_note / pending_work_by
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS only). No enum changes,
-- no data conversion, existing rows untouched.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── Depart (CNC + Outsource) ──
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS depart_flag        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS depart_note        TEXT,
  ADD COLUMN IF NOT EXISTS depart_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS depart_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depart_cleared_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS depart_cleared_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Still Pending Work (Outsource only) ──
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS pending_work_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_work_note  TEXT,
  ADD COLUMN IF NOT EXISTS pending_work_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Dispatch hold (mirror of depart, so the dispatch page can filter) ──
ALTER TABLE public.slab_requirements
  ADD COLUMN IF NOT EXISTS dispatch_hold      BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
COMMIT;
