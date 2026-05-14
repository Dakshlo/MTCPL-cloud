-- ──────────────────────────────────────────────────────────────────────
-- Migration 037 — Crosscheck role for the new Finance workflow
-- ──────────────────────────────────────────────────────────────────────
-- Replaces the biller → owner-approval → accountant pipeline with:
--
--   accountant adds bill
--        ↓
--   bill status = pending_approval
--        ↓
--   crosscheck verifies   (or owner approves — fallback still works)
--        ↓
--   bill status = approved (outstanding)
--        ↓
--   accountant proposes payment → owner confirms → accountant marks paid
--
-- The "biller" role stays in the enum for back-compat (any historical
-- biller-role profile keeps working) but is dropped from the role
-- picker in Settings so admins stop minting new ones. Accountant
-- now does both bill entry AND payment work — Daksh's call after
-- shipping the original biller role in migration 028.
--
-- The new "crosscheck" role's only Finance permission is to move bills
-- from pending_approval → approved. Payments stay as owner's confirm
-- step. canApproveBills helper picks up crosscheck via this enum value
-- + the existing role-check pattern.
--
-- ALTER TYPE ... ADD VALUE must run OUTSIDE BEGIN/COMMIT in Postgres —
-- same convention as migrations 027, 028, 032. The follow-up steps
-- (currently none — schema otherwise unchanged) go in a transaction
-- if needed in future revisions.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'crosscheck';

NOTIFY pgrst, 'reload schema';
