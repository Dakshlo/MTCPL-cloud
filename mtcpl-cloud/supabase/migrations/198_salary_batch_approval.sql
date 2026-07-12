-- ─────────────────────────────────────────────────────────────────────────
-- Migration 198 — Employees dept: OWNER approval for salary batches.
--
-- Daksh: when a salary batch is first created it must be approved by an owner
-- before its HDFC bank CSV can be downloaded (so no one pays a batch the owner
-- hasn't signed off on). A batch with approved_at IS NULL is "pending"; the
-- Pay-salary card shows a "waiting for owner approval" banner and the CSV stays
-- locked. The owner approves from the Batch-approval panel (or inline).
--
-- Existing batches predate this flow, so BACKFILL them to approved (using their
-- created_at) — otherwise they'd all be retroactively blocked. New batches
-- insert with approved_at NULL and go through approval.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.salary_batches add column if not exists approved_at timestamptz;
alter table public.salary_batches add column if not exists approved_by uuid;

update public.salary_batches
   set approved_at = coalesce(approved_at, created_at, now())
 where approved_at is null;

notify pgrst, 'reload schema';
