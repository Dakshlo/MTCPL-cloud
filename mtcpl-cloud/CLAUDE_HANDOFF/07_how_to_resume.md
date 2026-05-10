# 07 · How to resume — paste this into a new Claude

If the previous Claude conversation died and you (Daksh) want a new Claude to pick up exactly where it left off, send the new Claude this message:

---

```
I'm continuing a long Claude conversation about my project at
/Users/home/Documents/DEVELOPMENT/mtcpl-cloud (MTCPL — stone fab company).

Before doing anything, read every file in CLAUDE_HANDOFF/ in order:
  1. README.md
  2. 01_user_and_business.md
  3. 02_tech_and_conventions.md
  4. 03_data_model_and_migrations.md
  5. 04_modules.md
  6. 05_changelog.md
  7. 06_open_items.md
  8. 07_how_to_resume.md (this file — for context on how to behave)

Then resume working on whatever I ask. Treat the system as production-real.

Conventions to keep:
- After every commit you ship, append an entry to CLAUDE_HANDOFF/05_changelog.md
- After any new migration, update CLAUDE_HANDOFF/03_data_model_and_migrations.md
- After any role/module behaviour change, update CLAUDE_HANDOFF/04_modules.md
- After any reminder I give you, log it in CLAUDE_HANDOFF/06_open_items.md

I push to main, Vercel auto-deploys. I run migrations manually in Supabase
SQL Editor — give me the full SQL block + a verify query for each new one.

Now here's what I need:
[your new request here]
```

---

## What the new Claude should do on first read

1. Read all 8 files. Quickly — they're not long.
2. Form a model of the system: who uses it, what each module does, what's been shipped.
3. Pay particular attention to `06_open_items.md` — those are the active threads.
4. Confirm understanding back to Daksh in 2-3 lines max. ("Caught up. Latest commit is X. Outstanding items: Y, Z. What's next?")
5. Do NOT re-introduce yourself or explain things back to Daksh. He knows. Just confirm catch-up status and proceed.

## What the new Claude should NOT do

- Re-litigate decisions already made (e.g. "should we use temple cards or accordions?" — we shipped temple cards).
- Suggest new architecture wholesale. The system is built; we iterate.
- Ask clarifying questions about basics. Read the docs first.
- Add dependencies without asking.
- Change conventions (inline styles vs Tailwind, role names, migration numbering, etc).
- Skip updating the handoff folder after shipping. It's the safety net for the NEXT new Claude.

## How to keep handoff folder accurate

Treat it like a part of the codebase. Every commit that ships:
- Goes to `05_changelog.md` at the TOP (reverse chronological)
- Updates the relevant section of `04_modules.md` if behaviour changed
- Updates `03_data_model_and_migrations.md` if a migration was added
- Adds to `06_open_items.md` if Daksh said "remind me" or "later"

**Commit the handoff folder with each push.** Don't gitignore it — it's part of the project memory.
