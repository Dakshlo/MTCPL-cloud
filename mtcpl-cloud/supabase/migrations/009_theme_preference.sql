-- Per-user theme preference.
--
-- NULL = never toggled = treat as 'light' (the default). The user
-- only writes this column by explicitly clicking the sidebar toggle.
-- Once set, every device they log in from reads the same value and
-- applies it server-side, so the theme travels with the user account
-- rather than being stuck in one browser's localStorage.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference text
    CHECK (theme_preference IS NULL OR theme_preference IN ('light', 'dark'));

COMMIT;
