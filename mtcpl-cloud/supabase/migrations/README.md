# Database migrations

Every schema change that affects live data is captured here as a numbered
SQL file, so the state of the database is reproducible from source.

## Layout

```
supabase/
├── schema.sql                 ← original baseline (outdated — historical reference)
├── carving_phase_2_1.sql      ← follow-up baseline (historical)
└── migrations/                ← everything after that, in order
    ├── README.md              ← this file
    ├── 001_blocks_yard_1_to_9.sql
    ├── 002_slab_labels_table.sql
    ├── 003_slab_requirements_description.sql
    └── 004_slab_requirements_batch_id.sql
```

Baseline files (`schema.sql`, `carving_phase_2_1.sql`) represent the DB at
the time they were written. The `migrations/` folder carries forward every
change on top of them.

## Naming convention

```
NNN_short_snake_case_description.sql
```

- `NNN` = 3-digit zero-padded sequential number, starting at 001.
- File per logical change (one `ALTER TABLE`, one `CREATE TABLE`, etc.).
- Each migration is **idempotent** — re-running it is safe (`IF NOT EXISTS`,
  `DROP ... IF EXISTS` + recreate). No half-applied state.

## How to apply

### Option A — Supabase SQL Editor (manual, what we do today)

1. Open Supabase Dashboard → SQL Editor.
2. Open the migration file, copy its contents.
3. Paste into the editor, click **Run**.
4. If Supabase shows a "destructive operations" warning, read the file — if
   every `DROP` is paired with a recreate on the next line, it's safe.

Run them in order. Skipping a number isn't safe — later migrations may
depend on earlier ones.

### Option B — Supabase CLI (for when we move to a staging workflow)

```bash
supabase link --project-ref <project-id>
supabase db push
```

Supabase CLI will diff, plan, and apply any un-applied migration in order.
This is the recommended path once we have a staging environment.

## Rebuilding from scratch

If we ever need to rebuild the database from zero:

1. Run `supabase/schema.sql` first (creates all the original tables, RLS
   policies, enums, etc.).
2. Run `supabase/carving_phase_2_1.sql` (adds CNC vendor machine tables).
3. Run every file in `supabase/migrations/` in order (001, 002, 003, ...).

That sequence reproduces the current production schema.

## Rolling back

Each migration file should include a commented-out "-- ROLLBACK" block at
the bottom with the SQL that undoes it, when possible. Not all changes are
safely reversible (dropping a column loses data), but most additive ones
are.

## Adding a new migration

1. Number it with the next integer (check the highest `NNN_` in the folder).
2. Write idempotent SQL.
3. Test it on a throwaway database or the Supabase SQL Editor first.
4. Commit the file alongside the code change that depends on it.
