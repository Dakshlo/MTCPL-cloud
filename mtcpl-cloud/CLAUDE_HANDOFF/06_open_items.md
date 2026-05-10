# 06 · Open items, reminders, and known quirks

Live document. Update as things resolve.

---

## ⏰ Reminders for Daksh

### 1. Bind Vivek's profile when he logs in
He hasn't logged into the system yet. When he creates an auth user (phone OTP or email), run the bind SQL:

```sql
WITH au AS (
  SELECT id FROM auth.users WHERE phone = '+91xxxxxxxxxx' LIMIT 1
),
vn AS (
  SELECT id FROM public.vendors WHERE name ILIKE 'VIVEK' AND vendor_type = 'CNC' LIMIT 1
)
INSERT INTO public.profiles (id, full_name, role, vendor_id, is_active)
SELECT au.id, 'Vivek Lohar', 'vendor', vn.id, TRUE FROM au, vn
ON CONFLICT (id) DO UPDATE
  SET role='vendor', vendor_id=EXCLUDED.vendor_id, full_name=EXCLUDED.full_name, is_active=TRUE;
```

Same shape for Manthan (`MANTHAN`), Mohit (`MOHIT`), Alkesh (`ALKESH`) when they log in.

### 2. Stop the auto full-system backup
Daksh said this is running daily and eating egress quota. Not in app code — check:
- Supabase project → Database → Backups (Pro plan toggle)
- Supabase Edge Functions → Cron
- `pg_cron`: `SELECT * FROM cron.job;`
- Any GitHub Actions / Vercel cron / external script doing `pg_dump`

Ask Daksh which mechanism so the precise off-switch can be given.

### 3. Detailed cost report (Phase 2 of CNC Reports)
The simpler PDF is shipped (production summary — daily SQFT/CFT per machine). The DETAILED PDF (electricity / maintenance / tools / salary cost lines, opening / current / nett unit, working days, per-SQFT cost) needs an INPUT UI for the cost numbers since they're not tracked in the system. Daksh hasn't requested it yet — will do when asked.

---

## Pending features Daksh has mentioned

- **Operator-side dashboard**: "how many blocks did Ramesh cut this week" — deferred from the cutter operator workflow days.
- **Bulk operator deactivate / rename** — currently only inline + via SQL.

---

## Known quirks / footguns

### Schema cache freshness
After running any migration that adds a column or alters a function signature, ALWAYS append `NOTIFY pgrst, 'reload schema';` at the end. Without it, callers get errors like `Could not find the 'X' column of 'Y' in the schema cache` even though the column exists. Migrations 014, 020, 021 all include this.

### `"_ft"` columns store inches
`length_ft`, `width_ft`, `thickness_ft`, `height_ft` are all in INCHES despite the names. CFT = `(L × W × T) / 1728`. SQFT = `(L × W) / 144`. Don't trust the column name — trust the values.

### `select("*")` is the safest read pattern
When prod schema may be behind, `.select("*").maybeSingle()` returns whatever columns exist. Enumerated `.select("a, b, c")` returns null on the whole row if any one column is missing. We've been bitten by this twice (carving detail page → 404 fix; approve → "Job not found" fix).

### Server actions returning a redirect throw `NEXT_REDIRECT`
If you wrap an action call in a try/catch (e.g. for inline error handling), check `err.digest?.startsWith("NEXT_REDIRECT")` and re-throw. `finish-block-form.tsx` has the canonical pattern. Pattern in modals: send `stay=1` form field, the action returns instead of redirects, the client closes the modal + `router.refresh()`.

### Carving items `status` is TEXT, not the slab_status enum
`carving_items.status` accepts arbitrary strings. We use: `carving_assigned`, `carving_in_progress`, `completed`, `dispatched`, sometimes others. Don't assume it constraints to the slab_status enum.

### `cnc_machine_id` on cnc_machines is single-valued
Even on `multi_head_2` machines (which have 2 active items), only one is pointed to by `current_carving_item_id`. To find both heads, query `carving_items WHERE cnc_machine_id = m.id AND status = 'carving_in_progress'`. The unload action handles the pair via this query.

### IST date boundaries are approximated with local Date
We use `new Date().setHours(0,0,0,0)` for "today" rather than a strict IST-aware date library. Good enough for "today's count" displays. If a regulatory report ever needs exact IST midnight, revisit.

### `vendor_type='block_vendor'` slipped in via the block-side workflow
Some vendors are tagged `block_vendor`. They MUST be filtered out of every carving view. The carving page query already does `eq('vendor_type', 'CNC')` to enforce this. If you add a new query, do the same.

### Postgres CREATE OR REPLACE FUNCTION can't change argument lists
If you change `finish_block_cut`'s signature, you have to `DROP FUNCTION ...; CREATE OR REPLACE ...;` in the migration. Migration 020 does this.

### No `pgrst` reload on row inserts
Schema cache reload only matters for DDL. Row mutations propagate fine through the normal Supabase client.

### Vercel build cache can serve stale dynamic routes
`refreshAll()` calls `revalidatePath(...)` for the static + dynamic paths a mutation touches. After adding a new route, ADD IT to `refreshAll()` in `src/app/(app)/carving/actions.ts` (and equivalents) — otherwise the new route serves stale data after a related mutation.

---

## Open questions to ask Daksh next time

- Auto-backup mechanism: which one is running? (See Reminder #2 above.)
- Cost report: when do we build it? Will costs be entered manually each month, or sourced from somewhere?
- Dispatch + challan flow: any pending UX work? (Last touched a while ago — currently quiet.)
- AI module: should we add CNC-ops-aware tools, or is it fine as is?
- Onboarding new operators: any UI helper needed, or SQL-by-hand is OK for now?

---

## Things explicitly deferred

These were proposed but Daksh said "later" or "phases":

- Multi-head support beyond 2 heads (3-head, 4-head). Not in scope.
- Operator weekly/monthly performance dashboard.
- Per-machine cost tracking (electricity meter readings, etc).

---

## Things that currently DON'T work (or work differently than expected)

None known as of `d169407`. If something breaks, add it here with the date and what was expected vs observed.
