-- Migration 118 — Carving: "Involve owner" on Carving Done Approval (Daksh, June 2026)
--
-- During Carving Done Approval the reviewer can escalate a problem to the
-- owner (e.g. "No slab code"). The slab stays approvable/reworkable/
-- rejectable, but is flagged so it isn't forgotten, and shows up on a new
-- owner/developer Tasks page until the owner marks it resolved.
--
-- One OPEN issue per slab (kept simple): the state lives denormalised on the
-- carving_items row, so the existing carving cards read it for free.
--   owner_review_status  — 'open' | 'resolved' | NULL (no issue)
--   owner_review_kind     — 'no_slab_code' | 'other'
--   owner_review_note     — problem detail (free text for 'other')
--   owner_review_by/_at   — who raised it + when
--   owner_review_resolved_by/_at/_resolution_note — owner's resolution
--
-- SAFETY: additive ADD COLUMN IF NOT EXISTS only, on carving_items. No data
-- conversion, no enum changes (status is TEXT + CHECK). Idempotent.

BEGIN;

ALTER TABLE public.carving_items
  ADD COLUMN IF NOT EXISTS owner_review_status          TEXT NULL CHECK (owner_review_status IN ('open','resolved')),
  ADD COLUMN IF NOT EXISTS owner_review_kind            TEXT NULL,
  ADD COLUMN IF NOT EXISTS owner_review_note            TEXT NULL,
  ADD COLUMN IF NOT EXISTS owner_review_by              UUID NULL,
  ADD COLUMN IF NOT EXISTS owner_review_at              TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS owner_review_resolved_by     UUID NULL,
  ADD COLUMN IF NOT EXISTS owner_review_resolved_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS owner_review_resolution_note TEXT NULL;

-- Fast lookup for the owner Tasks page (only open issues).
CREATE INDEX IF NOT EXISTS carving_items_owner_review_open_idx
  ON public.carving_items (owner_review_at)
  WHERE owner_review_status = 'open';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.carving_items
--     DROP COLUMN IF EXISTS owner_review_status,
--     DROP COLUMN IF EXISTS owner_review_kind,
--     DROP COLUMN IF EXISTS owner_review_note,
--     DROP COLUMN IF EXISTS owner_review_by,
--     DROP COLUMN IF EXISTS owner_review_at,
--     DROP COLUMN IF EXISTS owner_review_resolved_by,
--     DROP COLUMN IF EXISTS owner_review_resolved_at,
--     DROP COLUMN IF EXISTS owner_review_resolution_note;
