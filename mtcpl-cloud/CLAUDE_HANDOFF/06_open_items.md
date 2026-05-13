# 06 · Open items, reminders, and known quirks

Live document. Update as things resolve.

---

## ⏰ Reminders for Daksh

### 0. Flip Rajesh Kumar's approver bit after migration 027

Migration 027 (Cutting approval workflow) ships the `profiles.can_approve_cuts` column with default `FALSE`. After running the migration, run this UPDATE in the SQL editor:

```sql
UPDATE public.profiles
   SET can_approve_cuts = TRUE
 WHERE full_name ILIKE 'RAJESH KUMAR%';
```

Without this, the top-bar **✓ Approvals** button never shows for Rajesh and the approval queue is invisible to him. Developer + Owner roles always qualify in code regardless — Rajesh is the only `team_head` that needs the bit flipped today. Add new approvers the same way.

### 0b. Flip Naresh's bill-approver bit after migration 028

Migration 028 (Accounts / Finance module) ships the `profiles.can_approve_bills` column with default `FALSE`. After running the migration, run this UPDATE:

```sql
UPDATE public.profiles
   SET can_approve_bills = TRUE
 WHERE full_name ILIKE 'NARESH%';
```

Developer + Owner roles always qualify regardless, so today this is primarily future-proofing for a non-owner approver. Naresh's row is the natural first to flip if his profile sits under any role other than `owner`.

Also remember to seed the new roles when assigning users:
- `biller` (data entry only, lands on `/accounts/bills/new`)
- `accountant` (dashboard + payments, lands on `/accounts`)

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
- **Per-temple default work-types** — Phase 4 left "this template always = lathe" out of scope. The work-type tag is set per-job at assign time today. A future small `temple_work_type_defaults` table could pre-fill the assign modal.
- **Bulk-assign view** — Phase 4 deferred the "auto-distribute N slabs across vendors" view. The carving head still picks one slab at a time. The assign modal's per-vendor capacity readout is the first step toward this.
- **Accounts v2: inventory cross-link** — migration 028 added `bills.inventory_ref_token` as a stub column for the future inventory module. When that ships, every bill that lands `paid` should also create an inventory row tagged with the same token so a single physical purchase ties the financial and material records together. The biller-side form will gain "items table" entries (qty + unit) so the inventory side gets structured rows instead of a free-text description.
- **Accounts v2: bill scan upload** — Daksh confirmed deferred for v1. Once Supabase Storage is configured, add a single-file upload on `/accounts/bills/new` + a thumbnail viewer on the audit page so the approver sees the actual paper bill while ticking the entry.
- **Accounts v2: TDS withholding** — Indian B2B convention. Add `bills.tds_percent` + `bills.amount_tds` columns; deduct from `amount_total` for the outstanding calc; reflect on payment proposals.
- **Accounts reporting** — PDF vendor statements, payment-history CSV/Excel export, optional WhatsApp/email to vendor on payment.

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

None known as of `901602d`. If something breaks, add it here with the date and what was expected vs observed.

### Lessons from past breakages

- **`use client` is required for any inline event handlers** (onClick, onMouseEnter, onChange, etc.). If you add a handler to a component without that directive, /dashboard or whatever page renders the component will 500. We hit this with TvModeEntryCard (commit `ddf2aa8` → hotfix `901602d`). Always check. Pattern when a server-rendered page needs a small client interaction: extract a tiny client-component file (see `src/components/print-button.tsx` for the canonical example — accepts children + className + style props).
- **Server actions silently swallowing errors** — wraps that just `console.error` and continue mean users see "saved" with nothing actually saved. Always surface via toast. We hit this with vendor machine sync (`ec4ab64`).
- **Don't trust DB defaults that were defined in an early bootstrap script** — `cnc_machines.id` was supposed to default to `gen_random_uuid()` per `carving_phase_2_1.sql`, but on prod the default was missing (likely lost when an earlier draft migration recreated the table). Inserts that omitted `id` failed with NOT NULL violations. Fixed via migration 022 + app-side `crypto.randomUUID()` fallback. Lesson: when an INSERT depends on a DB default, generate the value app-side as a backup. Pure-client UUIDs are cheap insurance.
