-- ──────────────────────────────────────────────────────────────────
-- Migration 074: profiles.can_assign_carving flag
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Daksh: Mohit is a CNC vendor (has his own cockpit) AND he's the
-- person who assigns the carving for his own work. Today the
-- carving-head function is gated on role='carving_head', but
-- Mohit's primary identity is 'vendor' — so he can't reach
-- /carving without changing his role (which would break his
-- cockpit access).
--
-- Cleanest fit with the existing per-profile flag pattern
-- (can_approve_bills, mig 028) — add a boolean that grants
-- carving-head-lite access. The "lite" part: holders see
-- Unassigned / Active / Carving Done tabs on /carving, plus the
-- Required Sizes (/slabs) page for inventory awareness. They do
-- NOT get the Awaiting Review tab — that stays owner/team-head
-- territory (it's the team's sign-off queue).
--
-- The flag is independent of the role. So a profile with
-- role='vendor' + can_assign_carving=TRUE keeps the cockpit and
-- adds the planning surfaces. A profile with role='carving_head'
-- already has full access; the flag is a no-op for them.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_assign_carving BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.can_assign_carving IS
  'When TRUE, the user can access /carving (minus Awaiting Review) and /slabs in addition to whatever their role allows. Mirrors the can_approve_bills (mig 028) pattern. Typically set on a vendor profile so they can assign work to themselves.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- To grant Mohit (or any vendor) the carving-head-lite access:
--   UPDATE public.profiles SET can_assign_carving = TRUE
--     WHERE full_name ILIKE 'mohit%'
--       AND role = 'vendor';
