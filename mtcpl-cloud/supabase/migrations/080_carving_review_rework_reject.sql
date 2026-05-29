-- ──────────────────────────────────────────────────────────────────
-- Mig 080 — Carving review split: approve / rework_needed / reject
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 — until now the carving review queue had two
-- outcomes: approve (slab → completed → dispatch) and reject (slab
-- → carving_in_progress → vendor re-loads on a CNC). The reject
-- path was light — a reason in review_notes and the timestamp lost
-- in the existing review_approved_at column.
--
-- Daksh wants three outcomes now:
--
--   1. APPROVE             same as today; image upload OPTIONAL
--   2. REWORK NEEDED       (new) image + reason MANDATORY. Slab
--                          returns to the vendor in a NEW "Rework
--                          Pending" bucket with the photo + reason
--                          attached. Vendor either reloads on CNC
--                          or re-marks complete; either way the
--                          slab eventually re-enters the review
--                          queue.
--   3. REJECT              (new, harsh) image + reason MANDATORY,
--                          two confirmations on the client. Slab
--                          status flips to a brand-new
--                          'carving_rejected' value — out of the
--                          active loop entirely. Visible in a
--                          read-only "Rejected" window on the
--                          vendor cockpit + a new "Carving
--                          Rejected" Tasks badge for owner / dev /
--                          carving_head / senior_incharge.
--
-- Production-data safety:
--   • All new columns are NULLABLE. Existing rows stay at NULL on
--     the new fields. Zero data drift.
--   • New enum value 'carving_rejected' is added BEFORE the BEGIN
--     so it commits regardless of the transaction's fate.
--   • Old "reject" rows (the pre-080 ones — status =
--     'carving_in_progress' with review_notes set) keep their
--     existing semantics: nothing on the cockpit splits them out
--     into "Rework Pending" because they don't have
--     review_reworked_at set. They look like normal queued jobs,
--     exactly as today.
--   • Storage bucket is private — images served via signed URLs
--     minted by getSignedReviewMediaUrl() on the server.

-- ALTER TYPE … ADD VALUE has to live OUTSIDE BEGIN/COMMIT.
ALTER TYPE public.slab_status ADD VALUE IF NOT EXISTS 'carving_rejected';

BEGIN;

-- ── 1. carving_items new columns ────────────────────────────────
-- review_decision is a free-form text tag we set on every review
-- action so the cockpit + analytics can tell APPROVE / REWORK /
-- REJECT apart without inferring from timestamps. NULL on pre-080
-- rows + on rows that haven't been reviewed yet.
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_decision TEXT NULL
    CHECK (
      review_decision IS NULL
      OR review_decision IN ('approved', 'rework_needed', 'rejected')
    );

-- review_image_path → storage key in the carving_review_media
-- bucket. Optional on approve; mandatory on rework + reject (the
-- action enforces, not the DB).
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_image_path TEXT NULL;

-- review_reworked_at / by — set when reworkCarvingJobAction fires.
-- Distinguishes a NEW rework from old "carving_in_progress" rows
-- that were rejected pre-080 (those have review_notes but no
-- review_reworked_at).
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_reworked_at TIMESTAMPTZ NULL;
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_reworked_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- review_rejected_at / by — set when rejectCarvingJobAction fires.
-- The slab's status also flips to 'carving_rejected' at the same
-- time; these two timestamps coexist for audit + display.
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_rejected_at TIMESTAMPTZ NULL;
ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS review_rejected_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Partial index for the "Carving Rejected" tasks badge count.
-- Cheap COUNT(*) over rejected rows that aren't soft-deleted /
-- archived. The badge re-queries this on every layout render.
CREATE INDEX IF NOT EXISTS carving_items_rejected_idx
  ON public.carving_items (review_rejected_at DESC)
  WHERE review_rejected_at IS NOT NULL;

-- Partial index for the vendor cockpit "Rework Pending" window —
-- "where am I being asked to redo work?". Scoped by vendor_id
-- because each cockpit only sees its own vendor's queue.
CREATE INDEX IF NOT EXISTS carving_items_rework_pending_idx
  ON public.carving_items (vendor_id, review_reworked_at DESC)
  WHERE review_reworked_at IS NOT NULL
    AND review_decision = 'rework_needed';

-- ── 2. carving_review_media storage bucket ──────────────────────
-- Private bucket. Reason images on rework + reject go here; the
-- approve flow optionally stamps in too. Path layout:
--   <reviewer_profile_id>/<carving_item_id>-<uuid>.<ext>
-- Reviewer-scoped so an audit ever needed "who uploaded what" can
-- trace by path prefix.
INSERT INTO storage.buckets (id, name, public)
VALUES ('carving_review_media', 'carving_review_media', FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── 3. RLS — same posture as every table post-029. Reads via the
--    blanket authenticated_read_all policy (so realtime + lazy
--    signed-URL fetches work from the browser supabase client);
--    writes go through the service-role admin client in the
--    server actions. No new write policies needed.
-- ────────────────────────────────────────────────────────────────
-- carving_items already has RLS + the authenticated_read_all
-- policy from mig 029. No change needed.

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- New columns should exist + accept the four review_decision
--   -- values (NULL + the three explicit ones).
--   \d carving_items
--
--   -- Storage bucket exists + is private.
--   SELECT id, public FROM storage.buckets WHERE id = 'carving_review_media';
--
--   -- Slab status enum now includes 'carving_rejected'.
--   SELECT enumlabel FROM pg_enum
--     WHERE enumtypid = 'public.slab_status'::regtype
--    ORDER BY enumsortorder;
--
--   -- Every existing carving_items row should have NULL on all
--   -- new fields → byte-identical to pre-080 behaviour.
--   SELECT
--     COUNT(*) FILTER (WHERE review_decision IS NULL)   AS no_decision,
--     COUNT(*) FILTER (WHERE review_reworked_at IS NULL) AS no_rework,
--     COUNT(*) FILTER (WHERE review_rejected_at IS NULL) AS no_reject,
--     COUNT(*) total
--   FROM carving_items;
-- ──────────────────────────────────────────────────────────────────
