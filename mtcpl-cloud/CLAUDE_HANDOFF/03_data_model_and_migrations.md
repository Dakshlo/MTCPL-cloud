# 03 · Data model and migrations

## Migrations folder

`supabase/migrations/00X_description.sql` — numbered, additive, safe to re-run (idempotent guards everywhere).

| # | File | What it adds |
|---|---|---|
| 001 | `blocks_yard_1_to_9.sql` | Expand block.yard from 1-3 to 1-9 |
| 002 | `slab_labels_table.sql` | Reusable slab labels (e.g. KAMAL-1, BEAM-2) |
| 003 | `slab_requirements_description.sql` | `slab_requirements.description` text column |
| 004 | `slab_requirements_batch_id.sql` | Batch ID for grouped slab adds |
| 005 | `chat_sessions.sql` | AI chat session storage |
| 006 | `chat_messages_images.sql` | Image attachments on chat messages |
| 007 | `marble_support.sql` | New stone types beyond Pink/White |
| 008 | `dispatches.sql` | Dispatch station tables (dispatches, dispatch_logs) |
| 009 | `theme_preference.sql` | `profiles.theme_preference` (light/dark cross-device sync) |
| 010 | `merge_vendor_dupes.sql` | Cleanup migration for duplicate vendor rows |
| 011 | `dispatch_provisional_and_challan_number.sql` | Provisional approval step + challan numbering |
| 012 | `cutsblocks_needs_reprint.sql` | `needs_reprint` flag on cut_session_blocks |
| 013 | `pending_cut_and_cutter_seq.sql` | `pending_cut` status + cutter sequence |
| 014 | `carving_location_and_ready_to_dispatch.sql` | Carving items get `location`, `ready_to_dispatch_at`, `ready_to_dispatch_by` |
| 015 | `cut_session_slabs_is_filler.sql` | Fit-to-Fill marker on `cut_session_slabs` |
| 016 | `operators.sql` | `operators` table for cutter operator selection |
| 017 | `profiles_last_path.sql` | `profiles.last_path` (heartbeat tracking) |
| 018 | `finish_block_cut_rpc.sql` | Single-RPC cutting-done function (atomic, fixes timeout bug) |
| 019 | `cnc_ops.sql` | CNC ops module — machine status, current_carving_item_id, maintenance, urgency, loaded_at, etc. |
| 020 | `stock_location.sql` | `slab_requirements.stock_location` + RPC update with `p_stock_location` |
| 021 | `cnc_machine_type.sql` | `cnc_machines.machine_type` enum (single_head / multi_head_2 / lathe) |
| 022 | `cnc_machines_id_default.sql` | Restore `gen_random_uuid()` default on `cnc_machines.id` (was missing on prod, blocked new-machine inserts with NOT NULL violation) |

## How migrations get to prod

**Daksh runs them manually** in Supabase → SQL Editor. He copies the SQL block from the migration file (or from the chat) and pastes it. He has confirmed running 014, 018, 019, 020, 021. Earlier ones we assume ran when introduced.

When Daksh reports an error like `column "X" does not exist`, the most likely fix is "the migration that adds X hasn't run yet". Surface the exact migration filename so he can paste it.

## Current schema overview

### Core entities

```
auth.users (Supabase auth)
   ↓ id
public.profiles
   id, full_name, phone, role (app_role enum), vendor_id, is_active,
   theme_preference, last_seen_at, last_path
```

`app_role` enum values:
```
developer | owner | team_head | carving_head | block_slab_entry |
slab_entry | block_entry | cutting_operator | carving_assigner |
dispatch | vendor | worker
```
(`carving_head` is a custom value added via ALTER TYPE — Daksh confirmed running.)

### Block / slab / cutting

```
public.blocks
   id (text PK, e.g. MT-B-245), stone, yard (1-9), category (Fresh/Reused),
   length_ft, width_ft, height_ft, status (block_status enum), quality (A/B),
   created_by, updated_by, created_at, updated_at

public.temples
   id, name, code_prefix, default_stone, is_active

public.slab_requirements
   id (text PK, e.g. AGROHA-0002-13), label, temple, stone,
   length_ft, width_ft, thickness_ft   ← all stored in INCHES despite "_ft" name
   source_block_id → blocks.id, status (slab_status enum), priority,
   description, deadline, priority_note, batch_id,
   stock_location (added 020),
   created_by, updated_by, created_at, updated_at

public.cut_sessions
   id, session_code, kerf_mm, status, planned_by, approved_by, ...

public.cut_session_blocks
   id, cut_session_id, block_id, status (cut_block_status),
   layout (jsonb — placed slabs + remainder spec), needs_reprint,
   reprint_reason, restocked_block_id, cutting_seq, operator_id, ...

public.cut_session_slabs
   id, cut_session_block_id, slab_requirement_id, is_filler (bool)

public.operators              -- cutter operators (named individuals)
public.slab_labels            -- reusable label dictionary
```

### Carving (CNC ops)

```
public.vendors
   id, name, vendor_type ('CNC' | 'Manual' | 'Outsource' | 'block_vendor'),
   is_active

public.cnc_machines
   id, vendor_id, machine_code, operator_name, is_active,
   status ('idle' | 'carving' | 'maintenance' | 'inactive'),  -- 019
   current_carving_item_id → carving_items.id,                -- 019
   maintenance_reason, maintenance_flagged_at, maintenance_flagged_by, -- 019
   machine_type ('single_head' | 'multi_head_2' | 'lathe')    -- 021

public.carving_items
   id, slab_requirement_id, vendor_id, vendor_name, vendor_type,
   cnc_machine_id, note, status (TEXT, not enum),
   deadline_days, due_at,
   assigned_by, assigned_at,
   completed_at, progress_phase,
   review_approved_at, review_approved_by, review_notes,
   photo_urls (jsonb),
   location, ready_to_dispatch_at, ready_to_dispatch_by,    -- 014
   urgency ('normal' | 'urgent'),                            -- 019
   estimated_minutes, vendor_estimated_minutes,              -- 019
   loaded_at, loaded_by, unloaded_at, unloaded_by,           -- 019
   temporary_location                                        -- 019

public.cnc_machine_events                                    -- 019
   id, cnc_machine_id, event_type, carving_item_id, reason,
   message, user_id, created_at

public.carving_job_events                                    -- pre-019
   id, carving_item_id, event_type, message, user_id, created_at
```

### Dispatch

```
public.dispatches
   id, challan_number, temple, vehicle_no, driver_name, driver_phone,
   dispatched_at, expected_delivery_date, dispatched_by, notes,
   approved_at, approved_by, delivered_at, delivered_by,
   receiver_name, delivery_note

public.dispatch_logs
   id, dispatch_id, slab_requirement_id, dispatched_by, dispatched_at,
   dispatch_note
```

### Stones / catalog

```
public.stone_types
   id, name, color_top, color_front, color_side, sort_order, is_active,
   stone_category ('marble' | 'sandstone')
```

## Key enums

- `slab_status`: `open | planned | cutting | cut_done | carving_assigned | carving_in_progress | completed | dispatched | rejected`
- `block_status`: `available | reserved | consumed | discarded`
- `block_category`: `Fresh | Reused`
- `cut_session_status`: `draft | approved | in_progress | closed | cancelled`
- `cut_block_status`: `pending_worker | cutting | done_prompt | done | rejected` (also `pending_cut` added 013)
- `vendor_type`: `CNC | Manual` (the original enum). Soft string `'Outsource' | 'block_vendor'` also seen on rows.
- `app_role`: see above

## RPC function — `finish_block_cut`

Defined in migration 018, last updated by 020. Single PG function that handles the whole "Cutting Done" atomically (parent block → consumed, slabs → cut_done, remainders → blocks rows, donor block plan edits, etc). Takes 13 parameters as of 020 (added `p_stock_location TEXT`).

If you change its signature, you MUST `DROP FUNCTION ... ; CREATE OR REPLACE FUNCTION ... ;` in the migration — Postgres won't let you change argument lists with `CREATE OR REPLACE` alone.

## Things to remember about the data

- All slab dimensions are stored as **INCHES** even though columns are named `length_ft`, `width_ft`, `thickness_ft`. CFT = `(L × W × T) / 1728`. SQFT = `(L × W) / 144`. Legacy naming.
- `slab_requirements.id` and `blocks.id` are TEXT (not UUID). Auto-generated codes like `AGROHA-0002-13`, `MT-B-245`.
- `carving_items.id`, `cut_sessions.id`, `cut_session_blocks.id`, `vendors.id`, `cnc_machines.id` are UUIDs.
- Row Level Security is enabled on most tables but the app uses the **service-role key** (admin client) for everything. RLS only matters for the realtime subscriptions and any client-side direct queries (which we avoid).
