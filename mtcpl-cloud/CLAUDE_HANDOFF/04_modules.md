# 04 · Modules — current state of every surface

This is the "what does each page do, today" doc. Roles in parentheses are the ones who can see it.

## Dashboard — `/dashboard` (developer, owner, sometimes team_head)

Greeting header + online users pill. Below:

- **Push Urgent Alert** (`<PushPanel>`) — owner can push priority slabs to a notification feed. Center-peek modal expands the panel.
- **4 entry cards** in a row:
  - **Ask AI** — links to `/ask-ai`
  - **Block Journey** — opens as iframe peek modal
  - **🔎 ID Lookup** — center-peek modal that searches any slab/block id and shows full info
  - **📺 TV Mode** — opens `/carving/floor?mode=tv` in a new tab (developer + owner)
- **Reports row** — Block Report, Block Journey (full views) as iframe peeks
- **Screen Time Today** — heartbeat-derived per-user minutes, in a peek
- **Footer** — backup peek for developer

Rajesh gets a stripped-down dashboard (Block Journey card only). Detected by full_name substring match.

## Block inventory — `/blocks` (most roles)

Lists every block. Filters, search, the Block History peek section. Each block has its own detail page `/blocks/[id]`.

Reports at `/blocks/report` (data-rich) and `/blocks/journey` (timeline of cuts → slabs → ready → dispatched).

## Slab requirements — `/slabs` (slab_entry, block_slab_entry, owner, team_head, etc)

Add new slabs (form + bulk add up to 100), grid view of all open + planned slabs with priority chips, deadline pills, search.

Sub-routes:
- `/slabs/ready` — Ready Sizes (cut_done slabs, full inventory)
- `/slabs/view` — Plan Generator (the cutting plan workbench)

## Cutting — `/cutting` (cutting_operator, team_head, owner, dev, ...)

Sessions / blocks in various states. Pending Approval (pre-cut operator pick), Pending Cut, In Progress, Done Today, Cutting History.

Per-block detail page `/cutting/[id]` shows the 3D layout, slab list, finish-cutting form. The cutter fills Cutting Done; submission **stages the payload** in `cut_session_blocks.pending_approval_payload` (JSONB) and flips the block to `awaiting_approval` (migration 027). The atomic `finish_block_cut` RPC (migration 018) only runs at **approve time** — the cutter's mistakes never touch donor blocks or slab statuses until an approver signs off.

**Cutting Done flow** captures:
- Which slabs were actually cut (vs returned to open)
- Extras pulled from open inventory
- Transferred slabs claimed from another block's plan
- Remainder block pieces (with quality + yard overrides)
- **Stock location** (added 020) — applied to all cut slabs

**Print routes:**
- `/cutting/[id]/print` — pre-cut plan sheet (3D + 2D layouts, slab list with checkboxes, manual entry forms)
- `/cutting/[id]/labels` — post-cut sheet (every slab attributed to the block, with codes + dims + stock location). Cutter writes the IDs onto physical slabs.

The print page also has `MANUAL ENTRY` section + a `📍 Stock location` write-line (added in commit 898c46b).

### Cutting Approvals — `/cutting/approvals` (migration 027)

Supervisor checkpoint between Cutting Done and Done Today. Only a small set of approvers see the action surface:
- `developer` + `owner` always.
- `team_head` only when `profiles.can_approve_cuts = TRUE` (post-migration UPDATE sets Rajesh Kumar's row).

`canApproveCuts(profile)` in `src/lib/cutting-permissions.ts` is the single gate. The top bar layout (`src/app/(app)/layout.tsx`) shows a **✓ Approvals (N)** button between the user-name slot and the role pill — red dot when count > 0, count = total `awaiting_approval` + `awaiting_cutter_edit`.

Two new statuses on `cut_block_status`:
- `awaiting_approval` — cutter submitted, payload staged, approver reviewing. Cutters **cannot edit** unilaterally.
- `awaiting_cutter_edit` — approver pressed "Send back for edit" with optional note. Only now does the cutter (the original `submitted_for_approval_by` user, or any `cutting_operator` as fallback) get an editable form. Save flips status back to `awaiting_approval`.

Server actions (`src/app/(app)/cutting/actions.ts`):
- `finishBlockAction` (re-shaped) — stages payload + flips block to `awaiting_approval`. Returns `{ ok: true, awaitingApproval: true }`. No DB-side mutations to slabs / donor blocks.
- `approveCutAction` — approver-only. Pre-flight donor check on `transferred_slab_ids` (rejects if any donor is `done` / `rejected` — surfaces the blocking block ids). Then fires `finish_block_cut` RPC with the staged payload and clears `pending_approval_payload`.
- `approveCutFormAction` — thin void-returning wrapper for `<form action>` usage in the detail page. Redirects to `/cutting/approvals` on success or `?error=...` on failure.
- `requestCutterEditAction` — approver-only. Flips to `awaiting_cutter_edit` with `sent_back_note`. Notifies cutting operators.
- `editPendingApprovalAction` — approver path (status = awaiting_approval, stays the same) OR cutter path (status = awaiting_cutter_edit, flips back to awaiting_approval on save). Re-parses the same `FormData` shape as `finishBlockAction`.

The In Progress tab on `/cutting` shows a **👀 In Approval (N)** banner above the cards when there's anything in the approval flow. Approvers see total count; `cutting_operator` users see only their own submissions; the banner links to `/cutting/approvals` either way. The approvals route itself filters cutters down to their own rows.

The detail page `/cutting/[id]` adapts when status is `awaiting_approval` or `awaiting_cutter_edit`:
- Banner with submitted-at / submitted-by + optional sent-back note.
- Approve / Edit / "Send back (in queue)" buttons by role.
- `?edit=approval` query-flag re-renders the `FinishBlockForm` pre-filled from the staged payload (uses the new `initialPayload` + `editMode` props). Submit posts to `editPendingApprovalAction` and redirects back to `/cutting/approvals`.

## Carving — `/carving` (developer, owner, carving_head)

Phase 3 module. This is where most recent work has been.

Tabs:
- **Unassigned** — slabs in `cut_done` status. Grouped view shows TEMPLE CARDS; clicking a card opens center-peek with that temple's slab grid. Flat view shows everything as a flat list. Search + priority filter + date filter (Ready in: All / Today / Last 2d / 7d / 30d).
- **Active** — `carving_assigned` + `carving_in_progress` jobs. 6-state status ribbon: **▶ CARVING NOW** (CNC, loaded — with running-for + remaining timer), **🪚 MANUAL CARVING** (Manual vendor, in progress), **🪚 AWAITING MANUAL START** (Manual, queued), **🚚 AWAITING DELIVERY · Xh** (CNC, assigned but not yet received at vendor), **📦 AT VENDOR · Xh** (CNC, received but not yet loaded), fallback ⏳ WAITING. Plus a quick **🌀 LATHE** chip on cylindrical-tagged jobs and **🪚 MANUAL** chip on Manual-vendor jobs.
- **Awaiting Review** — completed by vendor, not yet approved. Cards show **⏱ waiting Xh** timer. Click → center-peek with full detail + event timeline. Approve / reject inline (no navigation).
- **Carving Done** — approved jobs. Shows a **CNC Report** quick link at top.

Toolbar:
- Single search bar (matches slab id / label / description / temple / stone / vendor / status / source block)
- ⚡ Priority toggle
- Grouped/Flat (unassigned only) OR By vendor / By temple (other tabs)
- 👥 Manage Vendors button → center-peek modal for vendor CRUD
- Result count + Clear all
- Date filter pill row (per tab — "Ready in" / "Assigned in" / "Completed in" / "Approved in")

Server actions live in `src/app/(app)/carving/actions.ts`. Notable:
- `assignCarvingJobAction` — carving head assigns slab to CNC OR Manual vendor (urgency, estimated_minutes, `requires_machine_type` for CNC).
- `acknowledgeReceiptAction` (Phase 4) — vendor operator OR carving head marks slab physically received at the vendor's shade. Closes the assign → load gap. Records a `received_at_vendor` event.
- `loadSlabOnMachineAction` — vendor loads slab. Validates machine type vs job tag + slab dims vs machine bed (migration 024). Auto-fills `received_at_vendor_at` if NULL at load time.
- `loadTwoSlabsOnMultiHeadAction` — vendor loads TWO identical slabs on a 2-head machine. Adds machine type+dim checks. Both slabs auto-receipted.
- `completeAndUnloadAction` — vendor unloads (also unloads paired item on 2-head machines).
- `updateRequiresMachineTypeAction` (Phase 4) — re-tag a CNC job's work type after the initial assign.
- `transferCarvingJobAction` (Phase 4) — change the vendor on a carving_items row. Auto-unloads the current CNC if loaded (records `unloaded_for_transfer` event). Blocks 2-head pairs. Preserves the row id so all events stay attached.
- `markCarvingStartedManuallyAction` / `markCarvingCompleteManuallyAction` (Phase 4) — carving head fires these on behalf of Manual carvers. Sets loaded_at + completed_at without involving cnc_machines. Manual carvers don't use the system.
- `flagMaintenanceAction` / `resolveMaintenanceAction` — machine maintenance with reason dropdown
- `approveCarvingJobAction` — auto-marks ready-for-dispatch (uses temporary_location). Supports `stay=1` to skip redirect (peek modal).
- `rejectCarvingJobAction` — sends back to vendor. Also supports `stay=1`.
- `getMachineHistory` / `getJobEvents` — read-only fetchers used by modals.
- Vendor CRUD: create / update / deactivate / reactivate / delete (hard delete only when vendor has zero machines + zero items). Migration 024 dim caps (`max_length_in / max_width_in / max_thickness_in`) flow through `machines_json` on the form payload.

## Slab Transfer — `/carving/transfer` (slab_transfer + developer + owner + carving_head)

Phase 4 follow-up. A dedicated runner role moves slabs from the
cutter's stock yard to each CNC vendor's shade. The page shows three
buckets:

- **Claimed by me** — slabs this runner has locked. Each row has
  a green **✅ Mark delivered** button (with optional dropoff_note
  field for when the slab is left somewhere different from the
  vendor's standard dropoff location) and a "Release claim" link.
- **Available to claim** — unclaimed slabs. Each row has a
  **📦 Claim** button. Sorted urgent first, then oldest first.
- **Claimed by other runners** — read-only awareness. carving_head
  + owner + developer can release someone else's claim (useful when
  a runner goes off shift).

Each row shows: 3D slab thumbnail · slab id · temple · dims ·
urgent/lathe chips · **From** (cutter's stock_location) → **To**
(vendor name + dropoff_location).

Server actions in `src/app/(app)/carving/actions.ts`:
- `claimSlabTransferAction` — race-safe; refuses if claimed_by is
  already set by someone else.
- `unclaimSlabTransferAction` — runner can release their own
  claim; carving_head + above can release anyone's.
- `acknowledgeReceiptAction` (extended in this PR) — accepts
  optional dropoff_note, clears the claim. Vendor + carving_head
  fallback paths still work.

Vendor cockpit (`/vendor`) splits Queue into **Pending stock**
(read-only, awaiting transfer) + **Ready to load** (delivered, can
load on a CNC). Stat tiles updated accordingly.

## Carving Floor — `/carving/floor` (developer, owner, carving_head)

Two modes:

- **Grid mode** — every CNC vendor's cockpit on one page. Fleet stats, per-vendor sections, machine grid, queue + 24h-completed (collapsed by default). Linked from Carving Jobs → Active tab via "📺 Open Floor View" button.
- **TV mode** (`?mode=tv`) — full-screen overlay (covers sidebar + topbar via z-index). One vendor at a time. Auto-rotates every N seconds (10/15/20/30/45/60s). Slide-in animation. Big text designed for wall-display viewing distance.
  - **Theme toggle** in the header — 🌙 Dark / ☀ Light. Persists in localStorage as `mtcpl_tv_theme`.
  - Dashboard entry card (developer + owner) opens TV mode in a new tab.

The Active tab on Carving Jobs no longer embeds the full floor view; only a button to open it.

Data computation lives in `src/lib/floor-view-data.ts` (used by `/carving/floor`).

## CNC Report — `/carving/reports` (developer, owner, carving_head)

Mirrors the office's paper sheet (the user shared a PDF). Per-machine daily SQFT + CFT for the selected month, grouped by operator. Lathes only get a CFT column (no SQFT — round work). Footer rows: GRAND TOTAL, AVG (per working day), fleet TOTAL, MTCPL per-machine avg.

Year + month picker (form GET, bookmarkable URL).

**Excel export**: `/api/reports/cnc-monthly.xlsx?year=Y&month=M` returns a real .xlsx via the `xlsx` package. Operator + machine-code rows are merged across each operator's machines so the structure matches the paper sheet. Daily values are numeric Excel cells (sum-able natively).

Data computation in `src/lib/cnc-monthly-report.ts`.

**Linked from Carving → Carving Done tab** (used to be a separate sidebar entry).

## Vendor cockpit — `/vendor` (vendor + dev/owner/carving_head)

The CNC supervisor's home page. When `vendor_id` is set on the profile, the page scopes to their vendor only. For dev/owner/carving_head users, a vendor picker dropdown lets them switch.

Layout:
- Top: vendor name, fleet stat tiles (Free / Carving / Maint / Queue)
- **Queue** section — slabs waiting to load (urgent first)
- **Machines** grid — one card per CNC. Color-coded:
  - 🟢 **FREE** — idle, has Load slab + Flag maintenance buttons + tiny 📊 history button
  - 🔵 **RUNNING** — slab info + ▶ running-for + ⏱ remaining + Mark complete button
  - 🔴 **DOWN** — reason + ⏱ down for + Back online form
  - ⚫ **OFFLINE** — inactive
- **Recent completed** — last 10 unloaded (with Edit location link if the slab moved post-unload)

Modals:
- **Load slab** — pick slab + machine + ETA. Switches to **2-head pair picker** when the selected machine is `multi_head_2` (filters second list to slabs matching the first by L×W×T + temple + label).
- **Mark complete + unload** — capture temporary_location. Also unloads the paired slab on 2-head machines.
- **Flag maintenance** — reason dropdown (tool_change / spindle_issue / electrical / coolant / scheduled_service / other) + detail textarea.
- **Edit location** — for completed-but-not-yet-shipped slabs.
- **Machine history** (📊 button) — last 30 days of events from `cnc_machine_events`, with totals (carving time, sessions, downtime, maint episodes).

Phase 4 queue-row additions:
- Each queue row shows a 🚚 **IN TRANSIT** vs 📦 **AT SHADE** pill so the vendor can tell at a glance whether the slab is still travelling or sitting on their floor.
- 🌀 **LATHE** chip on cylindrical jobs (work-type tagged at assign time).
- Green **✅ Mark received** button on rows where `received_at_vendor_at IS NULL`. Wires `acknowledgeReceiptAction`. The Load button is still available regardless — the load action also auto-fills the receipt timestamp if it's NULL.

Mobile-first throughout — vendor uses this on a phone on the floor.

## Vendor management — `/carving/vendors` (developer, owner)

Full vendor list with create / edit / delete. Per-vendor edit page at `/carving/vendors/[id]` has the form + machine sub-list + danger zone (deactivate).

Also accessible inline from the carving page header via the "👥 Manage Vendors" peek.

`block_vendor`-type vendors are filtered out of every CNC-related view (they're for the block-side workflow).

## Dispatch — `/dispatch` (developer, owner, carving_head)

Three tabs:
- **Make Dispatch** (Ready) — slabs in `completed` status, waiting to be packed
- **Provisional** — dispatch row created, awaiting senior approval
- **Out for Delivery** — approved + dispatched, not yet delivered
- **Delivered** — archive (last 200)

`approveCarvingJobAction` auto-feeds slabs into the Ready tab (sets `slab_requirements.status='completed'` + `ready_to_dispatch_at`).

## Challan — `/challan` (developer, owner)

Archive of dispatched challans. Reports + history.

## Settings — `/settings` (developer, owner, team_head)

User management (assign roles, deactivate), Temple Codes peek, Stone Types editor, Audit Log peek, Full System Backup peek, Live Users (developer-only).

## Ask AI — `/ask-ai` (most roles)

Chat surface backed by Anthropic API. Tool calls into our DB to answer "how many slabs left for AGROHA?" type questions. Out of scope for the carving work — left alone.

## My Jobs — `/vendor` aliased to "My Jobs" in vendor sidebar

Same page as the cockpit. Vendors see it labelled "My Jobs" in their sidebar.

## Accounts — `/accounts/*` (migration 028)

Brand-new finance vertical, orthogonal to cutting/carving. Two new roles plus owner sign-off:
- `biller` — fills the bill-entry form. Lands on `/accounts/bills/new`.
- `accountant` — runs the due-bills dashboard + payment workflow. Lands on `/accounts`.
- `owner` (and dev) — approves bills + ticks the pay-today batch.

Three new tables: `bill_vendors` (beneficiary master, separate from carving `vendors`), `bills` (master record with `amount_subtotal` + `gst_percent` + STORED GENERATED `amount_total` / `amount_outstanding`, token TOK-YYYY-NNNNN via trigger), `bill_payments` (per-payment lifecycle row — proposed → confirmed → paid; partial payments produce multiple rows).

### Bill lifecycle

```
pending_approval ──[owner approve]──► approved ──[full pay via trigger]──► fully_paid (terminal)
       │ ▲                                │
       │ │                                └──[admin cancel, only if no payments]──► cancelled
   [reject]│
       ▼ │
   rejected ──[biller edits + resubmits]── back to pending_approval
```

`amount_outstanding = amount_total − amount_paid` (generated). `amount_paid` is recomputed by the `recalc_bill_amount_paid` trigger every time a `bill_payments` row enters or leaves `paid`. Reversal supported (a voided cheque flips `fully_paid` back to `approved`).

### Payment lifecycle

```
proposed ──[owner ticks]──► confirmed ──[accountant marks paid]──► paid (terminal)
   │                            │
   └──[owner unticks]──┐         └──[accountant aborts]──► cancelled
                      ▼
                  cancelled
```

A single bill has many `bill_payments` rows over time. Each one carries the `proposal_batch_id` so the owner can confirm/un-tick a whole batch in one go. Un-ticked rows get auto-cancelled with `cancel_reason='owner_unticked'`.

### Routes
- `/accounts/bills/new` — bill-entry form (biller). Combobox over active `bill_vendors` with inline "+ Add new" quick-add. GST% quick-pick chips (0/5/12/18/28/custom). Live total preview.
- `/accounts/bills` — list view with status + vendor filters. Biller sees own; everyone else sees all.
- `/accounts/bills/[id]` — detail: amount summary, audit trail, payment history table. Approve/Reject/Edit/Cancel by role + status.
- `/accounts/bills/[id]/edit` — reuses `BillEntryForm` with `mode='edit'`. Locked once any non-cancelled `bill_payments` row exists.
- `/accounts/approvals` — owner's audit queue. Direct copy of `/cutting/approvals` shape; two sections (Awaiting / Rejected), Approve / Edit / Send-back-with-note per row.
- `/accounts` — accountant dashboard. KPI cards (Total outstanding, Due bills, Avg days outstanding, Top vendor), aging buckets (0–30 / 31–60 / 61–90 / 90+), multi-select table to propose pay-today with per-row amount override.
- `/accounts/pay-today` — three sections: **Proposed** (owner ticks per batch), **Confirmed** (accountant marks paid with method + reference + actual amount — partial-friendly), **Paid today** (running total).
- `/accounts/payments` — historical ledger. Filters: date range, vendor, method. Defaults to last 30 days.
- `/accounts/vendors` + `/accounts/vendors/[id]` — `bill_vendors` CRUD with per-vendor outstanding totals + bill history.

### Permissions helper

`src/lib/accounts-permissions.ts`:
- `canSubmitBills(p)` — biller / owner / dev
- `canApproveBills(p)` — owner / dev / `p.can_approve_bills === true`
- `canConfirmPayments(p)` — same set as canApproveBills
- `canManageAccounts(p)` — accountant / owner / dev
- `canMarkPaid(p)` — accountant / dev (strict: owner confirms, accountant executes)
- `canManageBillVendors(p)` — accountant / owner / dev

### Top-bar badges

`src/app/(app)/layout.tsx` shows two new badges, identical styling to the existing **✓ Cutting Audit** button:
- **₹ Bills Audit (N)** — visible to `canApproveBills`. Count = `bills WHERE status='pending_approval'`. → `/accounts/approvals`.
- **💸 Pay Today (N)** — visible to `canManageAccounts` OR `canApproveBills`. Count = `bill_payments WHERE status IN ('proposed','confirmed')`. → `/accounts/pay-today`.

Both queries hit partial indexes from migration 028 (`bills_pending_approval_idx`, `bill_payments_open_idx`).

### Out of scope (v1)
- **Inventory cross-link.** `bills.inventory_ref_token` column exists as a stub for v2 (when a bill clears, the inventory module will create a stock row with the same token). Never written in v1.
- **Bill scan / photo upload.** No Supabase Storage infra yet — owner reviews the physical paper bill while checking the entry. The description field carries item details.
- **TDS withholding.** Common in Indian B2B; not modelled.
- **Multi-currency.** All amounts ₹, stored as `NUMERIC(14,2)`.
- **Vendor statement / aging report PDF.** Defer.
- **CSV / Excel export** of payment history. Defer.
- **Vendor email / SMS** post-payment. Defer (no transactional email infra).
