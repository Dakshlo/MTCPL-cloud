-- 218 — full blackout switch
--
-- Maintenance mode (031/036/217) shows a lock screen to STAFF while the app
-- keeps running, and a developer can bypass it with a cookie. Blackout is a
-- different thing: it refuses every request to every URL from everybody,
-- including the developer, with no bypass anywhere in the application.
--
-- Why no bypass: the whole point is that someone probing the site finds
-- nothing to probe. A developer escape hatch is also an attacker escape
-- hatch, and a cookie-based one is exactly what a session-stealer would use.
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │  HOW TO BRING THE SYSTEM BACK                                        │
-- │                                                                      │
-- │  There is deliberately NO way to do this from inside the app - when  │
-- │  blackout is on, the Settings page is blacked out too. Run this in   │
-- │  the Supabase SQL editor (Project → SQL Editor → New query):         │
-- │                                                                      │
-- │      update system_settings                                          │
-- │      set value = '{"on": false}'::jsonb,                             │
-- │          updated_at = now()                                          │
-- │      where key = 'blackout';                                         │
-- │                                                                      │
-- │  The site returns within ~10 seconds (the middleware caches the flag │
-- │  briefly so it is not querying the database on every request).       │
-- │                                                                      │
-- │  To check the current state without changing it:                     │
-- │      select value from system_settings where key = 'blackout';       │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- Blackout touches NO business data. It is one boolean. Every slab, bill,
-- invoice and block is untouched and is exactly as it was when it comes back.

insert into system_settings (key, value)
values ('blackout', '{"on": false}'::jsonb)
on conflict (key) do nothing;
