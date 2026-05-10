# Claude Handoff — MTCPL Cloud

> Read this file FIRST before doing anything else in this codebase.

This folder is a complete brain dump of the project — for Daksh (the user) and for any future Claude instance that takes over this conversation. If the previous chat tab dies, the user pastes this folder into a new Claude conversation and the new Claude can pick up exactly where things left off.

---

## You are picking up from a previous Claude

The previous conversation has been ongoing for many weeks and produced 50+ shipped features. Treat the system as a real production tool — Daksh's company (MTCPL) actually runs operations on this software every day.

**Before responding to any new request, read in order:**

1. `01_user_and_business.md` — who Daksh is, what MTCPL does, who uses the system
2. `02_tech_and_conventions.md` — the stack, the patterns we use, the things we don't do
3. `03_data_model_and_migrations.md` — schema overview, migration history, what's pending on prod
4. `04_modules.md` — current state of every module (blocks, slabs, cutting, carving, dispatch, reports)
5. `05_changelog.md` — chronological commit history, so you know what we've shipped and why
6. `06_open_items.md` — pending tasks, reminders, deferred work, things to ask Daksh about

After that, you're caught up. Tackle the new request as if you'd been the one shipping the last 50 commits yourself.

---

## How Daksh works

- He types fast, casually, with typos. Don't ask for clarification on small things — infer.
- He often bundles many requests in one message. Address them all unless he says "phases".
- He likes "ship it now" pace. Default to one cohesive commit per request batch unless the scope genuinely needs splitting.
- Migrations are NOT auto-run. He has to paste SQL into Supabase SQL Editor manually. After every new migration, give him the full SQL block + a verify query.
- He pushes to `main`. Vercel auto-deploys. No PR / staging step.
- He runs Supabase Pro — backups, storage, etc are toggleable in the dashboard.

---

## How to keep this folder current

After every commit you ship, **append an entry to `05_changelog.md`** with the commit hash, the date (today's date), the modules touched, and a one-paragraph summary. If you add a migration, also update `03_data_model_and_migrations.md`. If you change behaviour for a role, also update `04_modules.md`.

If Daksh tells you something to remember (e.g. "remind me to bind Vivek's profile when he logs in"), add it to `06_open_items.md` immediately.

The user explicitly asked: **"update it every time we do new things so mention everything every stages"** — so this is part of the contract, not optional.

---

## Quick sanity check on first read

Run these in your head to confirm you have the right picture:

- "What does MTCPL do?" → it's a stone fabrication company in India making temple parts
- "Who is the carving head?" → a role separate from owner; runs the CNC carving floor
- "What's a `multi_head_2` machine?" → a CNC with two heads that carve identical slabs in lockstep
- "What's the latest migration on prod?" → check `03_data_model_and_migrations.md` for the answer Daksh has confirmed

If any of those feel unfamiliar, re-read the relevant doc before responding.
