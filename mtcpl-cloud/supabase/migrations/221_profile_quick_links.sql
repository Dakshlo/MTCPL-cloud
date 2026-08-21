-- 221: Per-user pinned links for the ⌘K palette (Daksh, Aug 2026).
--
-- Each person pins up to SIX pages they actually live in — "Carving Jobs",
-- "Cutter costing" — and those become buttons at the top of the palette on
-- every screen. It is a personal preference, like theme_preference and
-- active_department, so it belongs on the profile rather than in a table of
-- its own.
--
-- Shape: a jsonb ARRAY of hrefs, in the order the user arranged them.
--   ["/carving", "/reports/various-costing/cutter"]
--
-- NULL / absent = never chosen, and the palette falls back to a sensible
-- default for the role. An empty array [] is a deliberate "I want none".
--
-- The hrefs are validated against the nav registry when they are SAVED, and
-- again when they are RENDERED, so a pin to a page the user later loses access
-- to simply stops appearing rather than becoming a broken door.
--
-- Rollback: alter table public.profiles drop column quick_links;

alter table public.profiles
  add column if not exists quick_links jsonb;

comment on column public.profiles.quick_links is
  'Up to 6 hrefs pinned to the top of the quick-search palette, in user order.';

notify pgrst, 'reload schema';
