-- ──────────────────────────────────────────────────────────────────
-- Migration 066: bill_vendors.nickname — easier identification when
-- the same owner runs multiple firms
-- ──────────────────────────────────────────────────────────────────
-- Daksh: some vendor relationships span two or three firms under
-- the same owner — different legal names but identical bank
-- account, similar invoice patterns, etc. The bill team needs a
-- way to tag those with a human-friendly label (usually the
-- owner's name) so they can be matched across firms in a glance.
--
-- One nullable TEXT column on bill_vendors. Surfaced everywhere the
-- vendor name shows up + searchable in the Due Bills quick filter.
-- No constraints — free-form text, max 100 chars enforced at the
-- form layer.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.bill_vendors
  ADD COLUMN IF NOT EXISTS nickname TEXT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
