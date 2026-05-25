-- ──────────────────────────────────────────────────────────────────
-- Mig 076 — senior_incharge app_role
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 round 2 — Rajesh Kumar's permission set has grown
-- past what other team_head users should have. He needs everything
-- team_head currently covers (Blocks / Slabs / Plan Generator /
-- Cutting / Settings), PLUS:
--
--   • Ready Sizes Stock (read + Assign to vendors)
--   • Carving Jobs (full access — assign, approve Awaiting Review /
--     "Carving Done Approval", external cut-slab entry)
--   • Global My Jobs (read-only — view every vendor's cockpit, no
--     load / hold / complete actions)
--   • Awaiting Review queue in the topbar Tasks dropdown
--
-- Instead of bolting these onto every team_head user (broadens
-- access for people who shouldn't have it), we introduce a new
-- dedicated role: senior_incharge. Default audience is just Rajesh;
-- code grants senior_incharge a strict superset of team_head's
-- permissions.
--
-- Schema-side this is just an enum addition. No table changes —
-- all the new permissions are gated in code (canAccessCarvingPage,
-- canSeeAwaitingReview, the assign/approve action requireAuth
-- lists). ALTER TYPE … ADD VALUE has to run outside a transaction.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'senior_incharge';

NOTIFY pgrst, 'reload schema';
