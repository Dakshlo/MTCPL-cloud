-- ──────────────────────────────────────────────────────────────────
-- 146 — Backfill carving→dispatch receipt (Daksh, June 2026)
--
-- Phase 5 ships the gate that makes a carving-done slab CLICKABLE on the
-- Dispatch board only once received_at_dispatch_at is set (brought in by
-- the carving→dispatch transfer, or self-transferred at approval).
--
-- Every slab approved BEFORE this lane existed has ready_to_dispatch_at
-- set but received_at_dispatch_at NULL — without this backfill they'd
-- suddenly go non-clickable ("frozen") the moment the gate goes live.
-- Treat them as already received at dispatch so nothing in the current
-- backlog freezes. Run this AT THE SAME TIME the Phase 5 code deploys.
--
-- Idempotent: only touches rows still missing the receipt. Direct-
-- dispatch slabs (migration 130 — no carving_items row) are unaffected;
-- the board exempts them from the gate in code.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.carving_items
SET received_at_dispatch_at = ready_to_dispatch_at
WHERE ready_to_dispatch_at IS NOT NULL
  AND received_at_dispatch_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
