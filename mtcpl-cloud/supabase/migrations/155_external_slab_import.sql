-- ──────────────────────────────────────────────────────────────────
-- 155 — External cut-slab import via approval (Daksh, June 2026)
--
-- The carving "Add external cut slab" form is retired: externally-cut
-- slabs now come in through the SAME Excel-import-with-approval flow as
-- Required Sizes. A batch is tagged batch_type='external_slab' so the
-- Slab Import Approvals queue can label it "External slab add" and the
-- approver creates the slabs directly at status 'cut_done' (Unassigned)
-- — skipping the open → cut_session → cut_done lifecycle, exactly like
-- the old direct form did (source_block_id NULL).
--
--   • batch_type   — 'required_sizes' (default, existing) | 'external_slab'.
--   • to_dispatch  — external batches only: when TRUE the approver sends
--     the slabs STRAIGHT to dispatch (status 'completed' + direct_dispatched_at)
--     instead of Unassigned, so the dispatch incharge can pick them
--     immediately. Mirrors carving → Direct Dispatch.
--
-- Per-row stock_location for external rows lives inside the existing
-- `rows` JSONB (no column needed). Purely additive.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.slab_import_batches
  ADD COLUMN IF NOT EXISTS batch_type TEXT NOT NULL DEFAULT 'required_sizes'
    CHECK (batch_type IN ('required_sizes', 'external_slab'));

ALTER TABLE public.slab_import_batches
  ADD COLUMN IF NOT EXISTS to_dispatch BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
