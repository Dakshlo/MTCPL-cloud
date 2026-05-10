# 05 · Changelog

Reverse-chronological. Most recent at top. Append to TOP when shipping new work.

> Format: `commit_hash` — `module / topic` — short description. Migration filename if any.

---

## Recent (this Claude session)

### `(pending)` · fix: cnc_machines insert NOT-NULL on id + reports/page Print button
Two fixes in one commit:

1. **Migration 022**: restore `gen_random_uuid()` default on
   `cnc_machines.id`. Daksh hit `null value in column "id" of
   relation "cnc_machines" violates not-null constraint` when adding
   2-head and lathe machines. The original `carving_phase_2_1.sql`
   defined the default but it was missing on prod (lost in an
   earlier draft migration that recreated the table). Migration 022
   sets the default explicitly and is idempotent.
2. **App-side belt-and-suspenders**: `createVendorAction` and
   `updateVendorAction` now generate `crypto.randomUUID()` for new
   machine rows so inserts succeed even on a DB where the default
   has somehow gone missing again.
3. **`reports/page.tsx` Print button cleanup**: replaced the hacky
   `formAction="javascript:..."` button with the proper
   `<PrintButton />` client component (now accepts children +
   className + style props, defaults to "🖨 Print" + "ghost-button").
   Same pattern any other server-rendered page should use for
   client-side actions.

### `901602d` · hotfix: TvModeEntryCard needs 'use client'
The /dashboard route was 500-ing for everyone after the previous
TV Mode card was added — the card had onMouseEnter / onMouseLeave
handlers but no 'use client' directive, so React Server Components
crashed at render. Added the directive. Production was down for
~30 minutes between ddf2aa8 and 901602d.

### `ec4ab64` · Vendor save: surface machine sync errors
Daksh hit "adding machine in vendor not working". The machine
insert/upsert in `createVendorAction` + `updateVendorAction` had
try/catch blocks that just console.error'd and proceeded — silent
failure. Now the real Supabase error is surfaced via toast
("Machine sync failed: …"). Awaiting his retry to see the actual
underlying error.

### `ddf2aa8` · TV mode discoverability + dark/light + cleaner Active tab
- Removed the embedded Floor View vendor sections from the Active
  tab; replaced with a single "📺 Open Floor View" link card at the
  top. Active tab is now focused on the job cards.
- Removed "📺 TV Mode" sidebar entry. Added TV Mode as a 4th entry
  card on the owner / developer dashboard (`<TvModeEntryCard>` in
  src/components/tv-mode-entry-card.tsx, opens in a new tab).
- TV mode now has a 🌙 / ☀ theme toggle in the header. Dark theme
  (the original gradient) is back as an option; light stays the
  default. Choice persists via `localStorage["mtcpl_tv_theme"]`.
- Sidebar `isActive` logic for `/carving/floor` removed (no longer
  in sidebar — but the route still works). Page itself unchanged.

### `1d051f2` · CLAUDE_HANDOFF folder + CNC Report into Carving Done tab
Created `CLAUDE_HANDOFF/` at repo root: 8 markdown files
(README + 01–07) capturing user, business, stack, data model,
modules, changelog, open items, and resume instructions for a
fresh Claude. Going forward every commit appends to this folder.
Sidebar entry "📊 CNC Report" removed; link surfaced on Carving
Done tab instead.

### `d169407` · Carving Active tab embed + status ribbons
Active tab now shows a status ribbon per card (▶ CARVING NOW with running-for/remaining timer, or ⏳ WAITING with urgent chip). Above the cards: an embedded Floor View — fleet stats + per-vendor cockpit sections, with a 📺 TV mode quick-link. Sidebar `Floor View` renamed to `TV Mode` (deep-links to `?mode=tv`). Floor data builder extracted to `src/lib/floor-view-data.ts`.

### `13d9888` · TV light theme + 2-head CNC + peek = full detail (8 changes)
Big UX pass:
- TV mode: position:fixed full-screen overlay covering sidebar + topbar; light gradient theme.
- Queue + Done-24h list rows show CFT.
- Tab strip: single-colour gold-pill style (was 4 different colours).
- Floor View vendor sections: machines grouped by type (Single / 2× head / Lathe); queue + done-24h collapsed by default.
- Unassigned grouped: temple cards instead of accordions; click → center-peek with slab grid.
- Awaiting Review peek embeds full event timeline (no more "Open full ↗" link). Approve / reject use `stay=1` to skip server-side redirect; the peek closes itself + `router.refresh()`.
- 2-head CNC load: new `loadTwoSlabsOnMultiHeadAction`. Validates two slabs are identical (L×W×T + temple + label). `completeAndUnloadAction` unloads paired items together.

### `426eab2` · Running-since timer + machine history modal + monthly Excel report
Carving cards show `▶ running for X · ⏱ Y left` (both timers, side-by-side). `📊` button on every CNC card opens machine history modal — last 30d of events + totals (carving time, sessions, downtime, maint episodes). New `/carving/reports` page mirrors the paper sheet format. New `/api/reports/cnc-monthly.xlsx` route returns a real Excel file via the `xlsx` package.

### `fa07bfb` · Floor View polish: queue + 24h-completed lists, FREE label, slide animation
Slabs visible in queue and recent-done lists per vendor. AVAILABLE renamed to FREE everywhere. TV slide animation on rotation (CSS keyframe, 360ms slide-in from right).

### `613e4ff` · Simpler search, machine-type pills, Floor View + TV mode
Removed temple/stone dropdowns from carving toolbar (single search bar covers everything). Assign modal shows machine-type pill (2× HEAD / LATHE) per machine. New `/carving/floor` page with grid + TV modes. Sidebar entry added.

### `684354d` · Carving cards: description, waiting timer, latest-first sort, peek modal
Cards show temple, free-text description, waiting timer (Awaiting Review). Sort by latest activity desc within groups; groups sort by their freshest item. Card click opens center-peek `JobDetailPeek` instead of full-page nav.

### `898c46b` · Pagination + ready-since chips + machine_type + cutting print location
Unassigned slabs paginated (>500). Ready-since pills on slab cards. Migration 021 adds `cnc_machines.machine_type`. Vendor form gets type dropdown. Cockpit shows type pill. Cutting print form gets a stock-location panel.

### `3009ede` · Cutting Done: stock location + post-cut slab labels print
Migration 020 adds `slab_requirements.stock_location` + extends RPC. FinishBlockForm captures stock location (defaults to "Yard N"). New `/cutting/[id]/labels` print page lists every slab attributed to the block (plan + manual added later) with codes + dims + location.

### `ab2ed9c` · Approve bug fix + vendor-wise grouping + bigger CTAs
Fixed silent "Job not found" toast on approve — now surfaces real Supabase errors. Active/Review/Done tabs default to vendor-grouped (with By temple toggle). Approve / Reject buttons bigger.

### `1e3eaeb` · Date filter + inline vendor management peek
"Ready in / Assigned in / Completed in / Approved in" pill row (per tab semantics). 👥 Manage Vendors button → center-peek modal with rename / deactivate / reactivate / delete.

### `dc89ac2` · Stronger CNC card states + downtime timer + search/filters
Status pills + accents (FREE/RUNNING/DOWN/OFFLINE). Maintenance cards show ⏱ Down for X. New search bar + filter row on carving jobs page.

### `d531fa4` · Auto-ready on approve + days+hours timeline + center-peek assign
Approve auto-marks slab ready-for-dispatch (uses vendor's temporary_location). Time inputs ladder to days+hours. Assign modal converts from side drawer to center peek.

### `bc781ae` · Carving Phase 3: CNC ops cockpit + queue-based assignment
**Migration 019** — CNC ops module. Vendor cockpit at `/vendor`. Carving head's assign modal shows live free-CNC counts. Mobile-first vendor surface.

### `45fe7a7` · Carving cards: shrink
Fixed-height 3D thumbnail (80px), card grid min-width 290 → 200, padding/font-size shrink.

### `abd4aa7` · Dashboard: ID Lookup card
🔎 ID lookup card on dashboard (owner + dev). Center-peek modal that searches any slab/block id and returns full info.

### `a22b84f` · Carving vendors: exclude block_vendor type
Filter `vendor_type='block_vendor'` from carving views.

### `2da2de5` · Carving detail defensive query
`select("*")` instead of enumerated columns; surface real Supabase errors. Fixes 404 caused by a missing optional column on prod.

### `3f5f8d7` · Carving open to carving_head + 3D thumbnail cards
Detail page + lifecycle actions accept `carving_head`. Active/Review/Done tabs converted from table to card grid with 3D thumbnails.

### `03b9b56` · Add CARVING HEAD role
New `app_role` value `carving_head`. Lands on `/slabs/ready`. Access: Ready Sizes + Carving Jobs + Dispatch.

### `40d59b3` · Bump add-slab quantity cap from 50 to 100

### Earlier (cutting / floor improvements before carving rework)

- `f6b3b7b` — drop `updated_by` from cut_session_blocks done-flip in `finish_block_cut`
- `78a60de` — finishBlockAction rewritten as single PG-function RPC for atomicity
- `cc54b36` — finishBlockAction parallelize, surface real errors
- `02945a3` — fix: move maxDuration off server-actions module
- `c61134d` — NeedsReprint banner: bigger, sort to top
- `73de795` — finishBlockAction idempotent + 60s timeout
- `427eb78` — Cutting Done: combined extras + claim picker (one center-peek)
- `021f730` — Cutting [id] picker: paginate, lift 1000-row cap
- Older: Block Journey + Block Report enhancements, Cutting print improvements, Hindi labels, Settings peek modals, AI improvements.

---

## Migrations applied (in order)

See `03_data_model_and_migrations.md` for the table. Latest run on prod (Daksh confirmed): **021**.

Outstanding migrations awaiting run: **022** (`cnc_machines_id_default.sql`) — must be run before adding new CNC machines, otherwise the insert fails with `null value in column "id" ... violates not-null constraint`. Confirm with Daksh after he runs it.
