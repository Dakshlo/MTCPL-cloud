-- ──────────────────────────────────────────────────────────────────
-- Migration 041: Inventory module — Scaffolding (v1)
--
-- Why
-- ───
-- MTCPL runs 4+ ongoing construction sites at any given time and
-- sends scaffolding components (Standards, Ledgers, Transoms,
-- Braces, Jack bases, U-heads, Couplers, Planks, Ladders, Toe
-- boards) out to those sites as the projects need them. Today the
-- tracking is paper + memory:
--
--   • No central record of "Site Alpha currently has 50 standards".
--   • Parts get misplaced between sites.
--   • When a project closes, returns trickle back to the plant and
--     no one knows what's missing vs. what was lost.
--   • The owner has to walk the yard to know what's at the plant.
--
-- This migration sets up the first inventory vertical — Scaffolding.
-- Later modules (CNC tools, cement, motors, etc.) will be parallel
-- tables with the same shape. Scaffolding is the prototype.
--
-- Domain model
-- ────────────
-- Three concepts:
--
--   1. sites          — every physical location stock can live at,
--                       including the plant itself (is_plant=TRUE
--                       singleton row). One row per construction
--                       project plus one for the warehouse.
--   2. scaffolding_components — the catalog of part types in the
--                       fleet, identified by (component_type,
--                       size_spec). Standard 2.5m, Ledger 1.8m, etc.
--   3. inventory_movements — append-only ledger of stock transfers.
--                       Every issue/return/receive/writeoff lands
--                       here, one row per (component × qty) tuple,
--                       grouped by batch_id when multiple components
--                       move together on a single approval.
--
-- The current stock at any (component × location) is DERIVED from
-- approved movements:
--
--   qty_on_hand(c, s) =
--     SUM(qty)  where to_site_id   = s AND status='approved'
--   − SUM(qty)  where from_site_id = s AND status='approved'
--
-- No materialised stock table for v1 — the dataset is small (≤ ~20
-- components × ~10 sites × ≤ ~50 movements/week) and an aggregate
-- query is sub-millisecond. If we ever need it, a maintained
-- `inventory_stock(component_id, site_id, qty)` table is a small
-- follow-up migration with a trigger.
--
-- Approval flow (per Daksh)
-- ─────────────────────────
-- Storekeeper proposes a movement → status='pending_approval'.
-- Crosscheck (Mafat Purohit) OR owner reviews → flips to 'approved'.
-- Either can reject with a note → 'rejected', storekeeper edits and
-- resubmits. Storekeeper can also self-cancel before approval.
--
-- The audit role is the existing 'crosscheck' (mig 037), already
-- used for bill verification. Mafat is one human approving two
-- queues — inventory and bills. The badge styling on the top bar
-- mirrors the Bills "Crosscheck" badge.
--
-- One new role
-- ────────────
-- 'storekeeper' — the dedicated employee who manages the yard. Lands
-- on /inventory/scaffolding. Cannot approve their own movements;
-- crosscheck/owner does that. Kept strictly separate from the
-- existing 'dispatch' role per Daksh — they touch different physical
-- flows (dispatch handles outgoing carved slabs to customers;
-- storekeeper handles internal scaffolding logistics).
--
-- ALTER TYPE ADD VALUE has to live OUTSIDE the BEGIN/COMMIT block.
-- ──────────────────────────────────────────────────────────────────

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'storekeeper';

BEGIN;

-- ── Enums ─────────────────────────────────────────────────────────

-- The kind of stock movement. Each implies a (from, to) signature:
--   issue    : plant   → project site
--   return   : site    → plant
--   receive  : NULL    → plant     (vendor delivery; from_site_id=NULL)
--   writeoff : any     → NULL      (lost/damaged; to_site_id=NULL)
--
-- 'transfer' (site → site direct) and 'adjust' (physical count
-- reconciliation) are reserved enum values for v2 but not exercised
-- by v1 server actions.
DO $$ BEGIN
  CREATE TYPE public.inventory_movement_type AS ENUM (
    'issue',
    'return',
    'receive',
    'writeoff',
    'transfer',
    'adjust'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Movement lifecycle. Same shape as bills (mig 028) and cut
-- approvals (mig 027) — propose, approve, terminal.
DO $$ BEGIN
  CREATE TYPE public.inventory_movement_status AS ENUM (
    'pending_approval',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scaffolding component taxonomy. Each catalog entry picks one;
-- size_spec carries the length/spec for variants. Keeping the type
-- as an enum (rather than free text) lets the UI pin a consistent
-- SVG icon per kind across every screen.
DO $$ BEGIN
  CREATE TYPE public.scaffolding_component_type AS ENUM (
    'standard',     -- vertical poles
    'ledger',       -- horizontal lengthwise
    'transom',      -- horizontal widthwise / put-log
    'brace',        -- diagonal bracing
    'jack_base',    -- adjustable base / base plate
    'u_head',       -- fork head / top u-jack
    'coupler',      -- joint clamps (right-angle, swivel, sleeve)
    'plank',        -- working platform boards
    'ladder',       -- access ladders
    'toe_board',    -- safety edge planks
    'tie_rod',      -- shuttering ties
    'other'         -- escape hatch for non-standard parts
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── sites ─────────────────────────────────────────────────────────
-- Every place stock can sit. The plant is just another row with
-- is_plant=TRUE; a partial unique index pins it as a singleton so
-- we can't accidentally end up with two "Plant" rows.
CREATE TABLE IF NOT EXISTS public.sites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE,         -- short id, e.g. 'PLANT' / 'ALPHA' / 'BETA'
  name           TEXT NOT NULL,
  address        TEXT NULL,
  manager_name   TEXT NULL,                    -- free text for v1; FK to profiles in v2 if a site_manager role lands
  manager_phone  TEXT NULL,
  started_on     DATE NULL,
  closed_on      DATE NULL,
  is_plant       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sites_one_plant_idx
  ON public.sites (is_plant) WHERE is_plant = TRUE;

CREATE INDEX IF NOT EXISTS sites_active_idx
  ON public.sites (is_active, name) WHERE is_active = TRUE;

-- Seed the singleton plant row. Code 'PLANT' is reserved.
INSERT INTO public.sites (code, name, is_plant, is_active, notes)
VALUES ('PLANT', 'Plant (Warehouse)', TRUE, TRUE,
        'Main yard / warehouse. Singleton row — every movement that touches "the plant" references this id.')
ON CONFLICT (code) DO NOTHING;

-- ── scaffolding_components ────────────────────────────────────────
-- The catalog of part types + size variants the company owns. Each
-- card on the inventory board is one row from this table; the icon
-- is picked client-side based on component_type.
CREATE TABLE IF NOT EXISTS public.scaffolding_components (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                -- "Standard 2.5m", "Ledger 1.8m", etc.
  component_type  public.scaffolding_component_type NOT NULL,
  size_spec       TEXT NULL,                    -- "2.5m", "1.2m × 18ga", etc. Free text.
  unit            TEXT NOT NULL DEFAULT 'pcs',  -- pcs / kg / m / set
  description     TEXT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,   -- catalog sort key inside a type group
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT scaffolding_components_type_spec_unique
    UNIQUE (component_type, size_spec)
);

CREATE INDEX IF NOT EXISTS scaffolding_components_active_idx
  ON public.scaffolding_components (is_active, component_type, display_order)
  WHERE is_active = TRUE;

-- Seed the catalog. Storekeeper can edit / archive / add via the
-- /inventory/scaffolding/components screen. NULL spec for parts that
-- don't have meaningful size variants in this fleet.
--
-- ON CONFLICT does nothing — safe to re-run.
INSERT INTO public.scaffolding_components (name, component_type, size_spec, unit, display_order) VALUES
  -- Standards (vertical poles)
  ('Standard 1m',    'standard', '1m',   'pcs', 10),
  ('Standard 1.5m',  'standard', '1.5m', 'pcs', 20),
  ('Standard 2m',    'standard', '2m',   'pcs', 30),
  ('Standard 2.5m',  'standard', '2.5m', 'pcs', 40),
  ('Standard 3m',    'standard', '3m',   'pcs', 50),
  -- Ledgers (horizontal lengthwise)
  ('Ledger 0.9m',    'ledger',   '0.9m', 'pcs', 10),
  ('Ledger 1.2m',    'ledger',   '1.2m', 'pcs', 20),
  ('Ledger 1.8m',    'ledger',   '1.8m', 'pcs', 30),
  ('Ledger 2.4m',    'ledger',   '2.4m', 'pcs', 40),
  -- Transoms (horizontal widthwise / put-logs)
  ('Transom 0.7m',   'transom',  '0.7m', 'pcs', 10),
  ('Transom 1.2m',   'transom',  '1.2m', 'pcs', 20),
  -- Single-size singletons
  ('Brace (diagonal)','brace',    NULL,   'pcs', 10),
  ('Jack Base',       'jack_base',NULL,   'pcs', 10),
  ('U-Head',          'u_head',   NULL,   'pcs', 10),
  ('Coupler',         'coupler',  NULL,   'pcs', 10),
  ('Plank',           'plank',    NULL,   'pcs', 10),
  ('Ladder',          'ladder',   NULL,   'pcs', 10),
  ('Toe Board',       'toe_board',NULL,   'pcs', 10)
ON CONFLICT (component_type, size_spec) DO NOTHING;

-- ── inventory_movements ───────────────────────────────────────────
-- Append-only ledger. Every issue/return/receive/writeoff is one or
-- more rows, grouped by batch_id (one batch = one storekeeper
-- submission = one approval decision).
--
-- Location convention:
--   • from_site_id = NULL means "external source" (vendor delivery
--     for 'receive', or thin air for an opening-balance adjust).
--   • to_site_id   = NULL means "destination outside the fleet"
--     (writeoff to discard).
-- Every other movement points both ends at a real site row, with
-- the plant being just another site (is_plant=TRUE).
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID NOT NULL,
  movement_type     public.inventory_movement_type NOT NULL,
  status            public.inventory_movement_status NOT NULL DEFAULT 'pending_approval',

  -- Locations (see note above for NULL semantics)
  from_site_id      UUID NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  to_site_id        UUID NULL REFERENCES public.sites(id) ON DELETE RESTRICT,

  -- What moved
  component_id      UUID NOT NULL REFERENCES public.scaffolding_components(id) ON DELETE RESTRICT,
  qty               NUMERIC(12,2) NOT NULL CHECK (qty > 0),

  -- Proposal audit
  proposed_by       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  proposed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proposed_note     TEXT NULL,           -- driver name / vehicle / context
  batch_note        TEXT NULL,           -- denormalised batch-level note for easier history scan

  -- Decision audit (only one of these branches will be filled)
  approved_by       UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ NULL,
  rejected_by       UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at       TIMESTAMPTZ NULL,
  rejection_note    TEXT NULL,
  cancelled_by      UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at      TIMESTAMPTZ NULL,
  cancel_reason     TEXT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Coherence checks for the (type → endpoints) signature
  CONSTRAINT inventory_movements_issue_endpoints CHECK (
    movement_type <> 'issue' OR (from_site_id IS NOT NULL AND to_site_id IS NOT NULL)
  ),
  CONSTRAINT inventory_movements_return_endpoints CHECK (
    movement_type <> 'return' OR (from_site_id IS NOT NULL AND to_site_id IS NOT NULL)
  ),
  CONSTRAINT inventory_movements_receive_endpoints CHECK (
    movement_type <> 'receive' OR (from_site_id IS NULL AND to_site_id IS NOT NULL)
  ),
  CONSTRAINT inventory_movements_writeoff_endpoints CHECK (
    movement_type <> 'writeoff' OR (from_site_id IS NOT NULL AND to_site_id IS NULL)
  ),
  CONSTRAINT inventory_movements_endpoints_distinct CHECK (
    from_site_id IS NULL OR to_site_id IS NULL OR from_site_id <> to_site_id
  )
);

-- Indexes mirror the query patterns:
--   • Pending queue (top-bar badge + approvals page).
--   • Per-site recent activity (site detail page).
--   • Per-component aggregate (board card current qty).
--   • Batch lookup (review a single submission).
CREATE INDEX IF NOT EXISTS inventory_movements_pending_idx
  ON public.inventory_movements (proposed_at DESC)
  WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS inventory_movements_approved_to_site_idx
  ON public.inventory_movements (to_site_id, approved_at DESC)
  WHERE status = 'approved' AND to_site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_approved_from_site_idx
  ON public.inventory_movements (from_site_id, approved_at DESC)
  WHERE status = 'approved' AND from_site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_component_idx
  ON public.inventory_movements (component_id, status);

CREATE INDEX IF NOT EXISTS inventory_movements_batch_idx
  ON public.inventory_movements (batch_id);

CREATE INDEX IF NOT EXISTS inventory_movements_recent_idx
  ON public.inventory_movements (created_at DESC);

-- ── updated_at maintenance ────────────────────────────────────────
-- Same pattern used elsewhere. Generic trigger function may already
-- exist in the schema; create one local to this module if not.
CREATE OR REPLACE FUNCTION public.touch_updated_at_inventory()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS sites_touch_updated_at ON public.sites;
CREATE TRIGGER sites_touch_updated_at
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_inventory();

DROP TRIGGER IF EXISTS scaffolding_components_touch_updated_at ON public.scaffolding_components;
CREATE TRIGGER scaffolding_components_touch_updated_at
  BEFORE UPDATE ON public.scaffolding_components
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_inventory();

DROP TRIGGER IF EXISTS inventory_movements_touch_updated_at ON public.inventory_movements;
CREATE TRIGGER inventory_movements_touch_updated_at
  BEFORE UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_inventory();

-- ── RLS ───────────────────────────────────────────────────────────
-- Read-only for authenticated; writes go through the admin client
-- inside server actions (same pattern as bills / cuts).
ALTER TABLE public.sites                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scaffolding_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sites_read_authenticated"
  ON public.sites FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "scaffolding_components_read_authenticated"
  ON public.scaffolding_components FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "inventory_movements_read_authenticated"
  ON public.inventory_movements FOR SELECT TO authenticated USING (TRUE);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration manual: nothing required. The seed inserts handle
-- the plant row and component catalog. New sites are added through
-- the /inventory/sites screen by the storekeeper or owner.
--
-- Optional next steps (run separately if you want to grant the
-- storekeeper role to a profile right away):
--
--   UPDATE public.profiles
--      SET role = 'storekeeper',
--          active_department = 'inventory',
--          is_active = TRUE
--    WHERE full_name ILIKE '%<storekeeper full name>%';
-- ──────────────────────────────────────────────────────────────────
