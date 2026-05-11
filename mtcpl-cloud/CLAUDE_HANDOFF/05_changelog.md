# 05 · Changelog

Reverse-chronological. Most recent at top. Append to TOP when shipping new work.

> Format: `commit_hash` — `module / topic` — short description. Migration filename if any.

---

## Recent (this Claude session)

### `(pending)` · Mirror-pair grouping + roles dropdown + Ready Sizes today-default + sidebar reorder

Four smaller-scoped UX polish items from Daksh:

1. **Mirror-pair grouping in temple peek modal** — when the carving
   head opens a temple's slab grid, slabs that share (label + L×W×T)
   now get a shared coloured frame around their card. Singletons
   stay uncoloured so the eye lands on actual pairs / triples / etc.
   — exactly the slabs that are 2-head-pair candidates. A banner
   at the top of the modal explains the convention.
   Palette is 8 soft pastel tints; if a temple has >8 distinct
   shapes the palette wraps. Implementation in
   `TempleSlabsPeek` (dashboard-client.tsx).

2. **Settings → Users role dropdown** — added the two missing roles
   that were silently absent:
   - **CNC OPERATOR** (`vendor`) — for Mohit, Manthan, Vivek, etc.
   - **SLAB TRANSFER** (`slab_transfer`) — for the runner role
     added in migration 025.
   Both ROLE_ACCESS rows updated too so the access summary in the
   users table reads correctly.

3. **Ready Sizes** — page now defaults to today's cut date instead
   of "all time" (was overwhelming on a yard with 600+ cut slabs).
   Quick filter row expanded: Today · Yesterday · Last 3 days ·
   Last 7 · Last 30 · Last 90. Active preset gets a gold-pill
   highlight so the user can see which range they're on.

4. **Sidebar reorder** — moved Slab Transfer down to sit under
   My Jobs (was between Carving Jobs and Dispatch). Feels more
   natural as a vendor-adjacent workstation than tucked up with
   the dispatcher's tools.

### `(pending)` · Phase 4 UX polish: route visual, partitioned assign, inline manual, singleton 2-head load

Seven UX improvements stacked into one commit, all from Daksh's
feedback on the transfer + load flows:

1. **Transfer page route visualisation** — each row now shows a
   3-column layout: `[📍 From card]` `[→ animated arrow]`
   `[🏭 To card]`. Arrow runs a CSS gradient animation when this
   runner has the row claimed (kind="mine"). Stripped action
   buttons out of the side column and put them under the route
   so the From/To endpoints get full width.

2. **Assign modal CNC vs Manual partition** — vendor list is now
   split with section headers: "🏭 CNC Vendors" (with the per-type
   capacity breakdown) above, dashed divider, then "🪚 Manual
   Carvers" (compact rows, amber accent) below. Carving head can
   no longer accidentally treat a Manual carver as if they're CNC.

3. **Inline manual lifecycle buttons on Active cards** — Manual
   jobs get a `▶ Mark started` / `🎯 Mark complete` button right
   on the Active-tab card. Click stopsPropagation so it doesn't
   trigger the peek modal. No drilling into the detail page.

4. **Stock location chip on Unassigned cards** — every unassigned
   slab card now shows `📍 <stock_location>` so the carving head
   can scan where each cut slab currently sits before assigning.

5. **Load modal — singleton mode on 2-head CNCs** — new pair/single
   mode toggle when loading onto a 2-head machine. Single mode
   uses the existing `loadSlabOnMachineAction` (which already
   accepted multi_head_2 machines just fine) so we just route to
   it when mode="single". The "second head off" rare case is now
   reachable through the UI.

6. **Load modal — 3D card grid** — replaced the cramped vertical
   list of slab rows with a responsive grid of 3D thumbnail cards
   (auto-fill, min 140px). Each card shows: SlabThumb · urgency
   chip · lathe chip · slab id · temple · dims. Much easier to
   pick the right slab visually.

7. **Collapsible Pending stock + Recently completed** — vendor
   cockpit's Pending stock and Recently completed sections now
   collapse by default (▶ caret toggle). Pending stock is
   read-only and Recently completed is reference; neither needs
   to take screen space by default. The Ready-to-load section
   stays open since that's the actionable one.

Also: Load modal queue now filters to readyToLoad only (slabs in
transit can't be loaded), and the empty state explains why
("Check Pending stock — slabs need to be delivered first").

No schema change — pure UI work + ReadyToLoad split that came in
the previous commit's data model.

### `(pending)` · Slab Transfer role + claim/deliver flow + 3D thumbs on cockpit

A dedicated runner role that physically moves slabs from the cutter's
stock yard to each CNC vendor's shade. Plan-time decisions (from
clarification Q&A):
- Vendor's ✅ Mark received stays as a fallback (transfer person is
  primary path).
- Dropoff note is optional (empty = dropped at standard location).
- Claim-then-deliver model: runner clicks 📦 Claim first to lock the
  slab so two runners don't grab the same one.
- Lives at `/carving/transfer` (inside Carving section).

**Migration 025** (`slab_transfer_role.sql`):
- Adds `slab_transfer` to `app_role` enum (note: ALTER TYPE ADD
  VALUE can't be inside a transaction — first statement runs alone).
- `vendors.dropoff_location` — standard place to drop slabs for
  this CNC vendor (set on vendor edit form).
- `carving_items.dropoff_note` — where the runner actually left
  the slab (optional).
- `carving_items.claimed_by + claimed_at` — claim lock; partial
  indexes back the unclaimed-pending + claimed-by-me widgets.

**New actions in `actions.ts`**:
- `claimSlabTransferAction` — race-safe lock (only fires when
  `claimed_by IS NULL`).
- `unclaimSlabTransferAction` — runner can release their own
  claim; carving_head + owner + developer can release anyone's.
- Extended `acknowledgeReceiptAction` — accepts optional
  `dropoff_note`, clears the claim, records event with the note.

**New page `/carving/transfer`**:
- Three buckets: Claimed by me · Available to claim · Claimed by
  others.
- Each row: 3D slab thumbnail + slab id + temple + dims + chips
  (urgent / lathe) + From (stock_location) → To (vendor +
  dropoff_location) + assigned vendor.
- Buttons: 📦 Claim (Available) · ✅ Mark delivered + optional
  note (Claimed by me) · Release their claim (Claimed by others,
  carving_head+ only).

**Sidebar**: new 🚧 Slab Transfer entry under Carving Jobs.
Visible to slab_transfer + carving_head + owner + developer.
`slab_transfer` role lands on /carving/transfer after login.

**Vendor form**: new "Slab dropoff location" input (CNC only).
`createVendorAction` + `updateVendorAction` persist it.

**Vendor cockpit refactor**:
- Old single "Queue" section split into two:
  - **Pending stock** (assigned, not yet delivered) — read-only,
    shows the slab's current stock location. The transfer runner
    is responsible for delivering; vendor can't load yet.
  - **Ready to load** (delivered) — has the Load button as before.
- Stat tiles updated: Pending stock + Ready to load replace Queue.
- 3D slab thumbnail on each MachineCard when carving (uses the
  shared `SlabThumb` component).

**Shared component**: extracted `SlabThumb` from
`dashboard-client.tsx` into `src/components/slab-thumb.tsx` so the
transfer page + vendor cockpit can reuse without importing the
whole carving dashboard module.

**Carving dashboard cards**: surface claim status (🚧 runner has
it) under the 🚚 IN TRANSIT pill, and `dropoff_note` after delivery
(📍 left at <note>) so the team knows where to find the slab.

### `(pending)` · Phase 4 follow-up: surface 📍 slab location on in-transit pills

Daksh asked: while the slab is in transit (🚚 IN TRANSIT, not yet
received at vendor), the team needs to see WHERE it currently is so
they can fetch it. Re-uses `slab_requirements.stock_location` set
by the cutter at finish-block time (migration 020) — no new schema.

Surfaced on every in-transit surface:
- /carving Active tab cards — `📍 <location>` line under the
  🚚 AWAITING DELIVERY ribbon
- /vendor cockpit queue rows — `📍 <location>` between slab info
  and ETA
- /carving/floor + TV mode — small `📍 <location>` chip on each
  queue row
- /carving/[id] detail page — "Currently at" row in the assignment
  card (shown only while CNC + carving_assigned + not yet received)

Hidden once the slab is received at the shade (📦 AT SHADE) — at
that point the location is implicit (the vendor's shade) and the
chip just adds noise.

### `(pending)` · Carving Phase 4: receipt, machine constraints, work-type, transfer, Manual workflow

Five intertwined gaps in the carving workflow, addressed as one
PR. Plan lives at `/Users/home/.claude/plans/iridescent-churning-zebra.md`.

**Migrations 023 + 024** (additive, idempotent, NULL-safe):
- 023: `carving_items.received_at_vendor_at` + `received_at_vendor_by`
  to close the assign → load gap.
- 024: per-CNC `max_length_in / max_width_in / max_thickness_in` +
  per-job `requires_machine_type` (`NULL`=flat, `'lathe'`=cylindrical).

**New actions in `src/app/(app)/carving/actions.ts`**:
- `acknowledgeReceiptAction` — vendor operator OR carving head
  marks a slab physically received at the vendor's shade.
- `updateRequiresMachineTypeAction` — re-tag a job's work type
  after the initial assign.
- `transferCarvingJobAction` — change vendor on a carving_items
  row. Auto-unloads the current CNC if loaded. Blocks 2-head pairs.
  Preserves the row id so all events stay attached.
- `markCarvingStartedManuallyAction` /
  `markCarvingCompleteManuallyAction` — head fires these on
  behalf of Manual carvers (who don't use the system).

**Extended actions**:
- `assignCarvingJobAction` accepts `requires_machine_type` and
  now allows Manual vendors (was CNC-only).
- `loadSlabOnMachineAction` + `loadTwoSlabsOnMultiHeadAction`
  validate machine type vs job tag + slab dim vs bed envelope.
  Both also auto-fill `received_at_vendor_at` if NULL at load
  time (single attribution to the loader).
- `createVendorAction` + `updateVendorAction` persist the new
  `max_*_in` fields. New machines default to `multi_head_2`
  instead of `single_head` (the fleet has no single-head CNCs).

**UI**:
- Assign modal: Work-type pill (Flat panel / 🌀 Lathe). Per-vendor
  capacity readout splits multi-head vs lathe. Vendors with no
  free machine of the picked type sort low + render a caption.
  Manual vendors render a compact "no machines tracked" panel.
- Vendor form: per-machine `Max L / W / T ″` inputs. Type
  dropdown limited to 2-head + Lathe (single-head hidden but
  preserved as legacy display).
- Carving job detail page: new Workflow card with
  `✅ Mark received` (CNC, before load), `Re-tag work type`,
  `↔ Transfer` modal, and Manual `▶ Mark started` /
  `🎯 Mark complete` buttons.
- Active-tab cards (dashboard-client): 6-state ribbon —
  ▶ CARVING NOW, 🪚 MANUAL CARVING, 🪚 AWAITING MANUAL START,
  🚚 AWAITING DELIVERY (with age), 📦 AT VENDOR (with age),
  fallback ⏳ WAITING. New chips: 🌀 LATHE + 🪚 MANUAL.
- Vendor cockpit queue rows: 🚚 IN TRANSIT vs 📦 AT SHADE pill +
  green `✅ Mark received` button before load. 🌀 LATHE pill
  surfaces for cylindrical jobs.
- Floor view + TV mode: queue rows show the same in-transit /
  at-shade + lathe pill so the wall display reflects reality.

**Plan-time decisions** (from clarification Q&A):
- Per-CNC dim limits with separate L/W/T (not single "height").
- Work type tagged at assign time + re-taggable on detail page.
- Either side (vendor operator OR carving head) can mark received.
- Transfer allowed anytime before completion (auto-unloads if loaded).
- Fleet has only `multi_head_2` + `lathe`; no single-head machines.
- Manual carvers don't use the system; head fires lifecycle on
  their behalf — no receipt + load + unload, just Started + Complete.

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

Outstanding migrations awaiting run on prod:
- **022** (`cnc_machines_id_default.sql`) — must be run before adding new CNC machines, otherwise insert fails with `null value in column "id"`.
- **023** (`received_at_vendor.sql`) — adds the receipt timestamp columns. Without it the Mark Received button and at-shade pills won't work.
- **024** (`cnc_dim_limits_and_work_type.sql`) — adds per-CNC dim caps + per-job work-type tag. Without it the lathe-tag pill, machine-fit validation, and re-tag UI won't work.
- **025** (`slab_transfer_role.sql`) — slab_transfer enum value + dropoff + claim columns. Without it `/carving/transfer` will error on the missing columns. **Note**: this migration contains an `ALTER TYPE app_role ADD VALUE` that cannot run inside a transaction — it's the first statement, runs standalone, then BEGIN/COMMIT wraps the rest.

Confirm with Daksh after each. All are idempotent and additive; the app code is NULL-safe so running them late only disables the new features, not the existing flow.
