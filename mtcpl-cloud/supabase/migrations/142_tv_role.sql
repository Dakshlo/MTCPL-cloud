-- ──────────────────────────────────────────────────────────────────────
-- Migration 142 — add the 'tv' wall-display kiosk role to app_role
-- ──────────────────────────────────────────────────────────────────────
-- The 'tv' role boots straight into the carving floor TV view with no chrome
-- (no dashboard / sidebar / top bar; tiny corner sign-out only). The
-- TypeScript AppRole union already lists it (src/lib/types.ts) and it shows
-- in the Settings role picker — but the Postgres enum must include it too, or
-- assigning the role fails with:
--     invalid input value for enum app_role: "tv"
--
-- ALTER TYPE … ADD VALUE must run OUTSIDE a BEGIN/COMMIT block, and the new
-- value cannot be used in the same transaction — so this is a single bare
-- statement. IF NOT EXISTS makes it safe to re-run.
-- ──────────────────────────────────────────────────────────────────────

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tv';
