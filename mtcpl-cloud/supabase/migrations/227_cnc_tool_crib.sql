-- ──────────────────────────────────────────────────────────────────
-- Migration 227: CNC tool crib — the vendors' tool register
-- ──────────────────────────────────────────────────────────────────
-- Daksh (Oct 2026): the CNC vendors keep a PHYSICAL REGISTER for tools.
-- Somebody takes a thing, writes down the item, the quantity and their
-- name, and signs. He wants that on the software, with real stock
-- numbers and a warning when something runs low.
--
-- ── Why this is NOT part of the scaffolding inventory (mig 041) ────
--
-- 041's own header predicted this module: "later modules (CNC tools,
-- cement, motors, etc.) will be parallel tables with the same shape."
-- Parallel is exactly what this is. It borrows the APPROACH — an
-- append-only ledger, stock derived by summing it, a catalogue the user
-- builds for themselves — and none of the tables.
--
-- They are different problems. Scaffolding moves stock between SITES and
-- YARDS and every movement waits in a propose→approve queue. A tool crib
-- has one location and must be FASTER than the paper it replaces; an
-- approval step would make the software worse than the register. Keeping
-- the two apart means a change to one can never move the other's numbers,
-- and the storekeeper's scaffolding workflow is untouched by this file.
--
-- ── Who takes the tool is not who is logged in ─────────────────────
--
-- There are three vendor logins (MANTHAN, MOHIT, VIVEK) — one per
-- company, not one per operator. So the person who physically walks off
-- with a 450mm bit is NOT the authenticated user, and "person name and
-- sign" is precisely the information a login cannot capture. Every issue
-- therefore carries `taken_by` as a field of its own.
--
-- The row IS the signature: entered_by (who was at the screen) +
-- taken_by (who took it) + created_at, and the row is never edited or
-- deleted. That is a harder record to argue with than a scribble.
--
-- ── Stock is never stored ──────────────────────────────────────────
--
--   stock(tool) = SUM(delta) WHERE tool_id = tool AND undone_at IS NULL
--
-- There is no qty column to drift, and every number on screen can be
-- traced to the lines that made it. `delta` is SIGNED — receive/return
-- add, issue/scrap subtract, adjust may go either way — which replaces
-- the five endpoint CHECK constraints mig 041 needed with one.
--
-- ── Safety properties enforced here, not by convention ─────────────
--
--   • A movement can never be filed against another vendor's tool. The
--     composite FK (tool_id, vendor_id) → cnc_tools (id, vendor_id)
--     makes a cross-crib row impossible, so one vendor's mistake can
--     never move another vendor's stock.
--   • An issue without a name is rejected by the database. The whole
--     point of the register is who took it.
--   • The sign must match the kind. A "receive" cannot secretly remove
--     stock.
--
-- Nothing here is destructive. Two new tables, one new trigger
-- function. No existing table, view or policy is modified.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.cnc_tool_movements;
--   DROP TABLE IF EXISTS public.cnc_tools;
--   DROP FUNCTION IF EXISTS public.touch_updated_at_cnc_tools();
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. The catalogue ──────────────────────────────────────────────
-- Deliberately UNSEEDED. Same choice as scaffolding_component_types
-- (mig 084), where Daksh asked for the pre-filled list to be removed so
-- the people who use it build their own. Nobody in the office can name
-- every tool a CNC shop carries, and a wrong starter list is worse than
-- an empty one — it gets half-used and then ignored.
CREATE TABLE IF NOT EXISTS public.cnc_tools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The crib this tool belongs to. Each CNC vendor keeps their own
  -- stock; MOHIT's 450mm bits are not MANTHAN's.
  vendor_id     UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 80),
  -- Optional second line — size, grade, brand. Kept separate from the
  -- name so "450mm" and "450mm (carbide)" are visibly different tools
  -- rather than two near-identical strings.
  spec          TEXT NULL CHECK (spec IS NULL OR length(spec) <= 80),
  unit          TEXT NOT NULL DEFAULT 'pcs'
                  CHECK (length(trim(unit)) > 0 AND length(unit) <= 16),
  -- Per-tool low-stock line. NULL means "no opinion" and the UI falls
  -- back to its own heuristic, so a tool added in a hurry still warns.
  low_stock_qty NUMERIC(12,2) NULL CHECK (low_stock_qty IS NULL OR low_stock_qty >= 0),
  -- Milestone state for the low-stock alert: the stock level at the last
  -- warning. Without it a crib sitting below its line would fire a
  -- notification on every single issue, which is how people learn to
  -- ignore notifications. Cleared when stock climbs back above the line.
  low_alert_level NUMERIC(12,2) NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.cnc_tools IS
  'Mig 227 — CNC tool catalogue, one list per vendor crib. Built by the user at runtime; never seeded. Stock is NOT here: it is SUM(delta) over cnc_tool_movements.';
COMMENT ON COLUMN public.cnc_tools.low_alert_level IS
  'Mig 227 — stock at the last low-stock notification. Milestone state so the alert fires on crossing and on each further step down, not on every issue.';

-- Same tool twice in one crib is a data-entry mistake; the same tool in
-- two cribs is normal. Compared on trimmed lowercase so "450MM Tool"
-- and "450mm tool " collide the way a human would expect them to.
CREATE UNIQUE INDEX IF NOT EXISTS cnc_tools_unique_per_vendor_idx
  ON public.cnc_tools (vendor_id, lower(trim(name)), lower(coalesce(trim(spec), '')));

-- Target for the composite FK below — this is what makes a cross-crib
-- movement impossible rather than merely discouraged.
CREATE UNIQUE INDEX IF NOT EXISTS cnc_tools_id_vendor_idx
  ON public.cnc_tools (id, vendor_id);

CREATE INDEX IF NOT EXISTS cnc_tools_vendor_active_idx
  ON public.cnc_tools (vendor_id, display_order, name)
  WHERE is_active;

-- ── 2. The ledger ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cnc_tool_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  tool_id     UUID NOT NULL REFERENCES public.cnc_tools(id) ON DELETE RESTRICT,
  -- receive = bought or added · issue = taken by a person
  -- return  = brought back    · scrap = worn out or broken
  -- adjust  = physical count correction
  -- TEXT + CHECK rather than an enum: mig 084 had to convert an enum to
  -- TEXT to add a value, and this list will grow.
  kind        TEXT NOT NULL
                CHECK (kind IN ('receive', 'issue', 'return', 'scrap', 'adjust')),
  -- SIGNED. Stock is the sum of this column.
  delta       NUMERIC(12,2) NOT NULL CHECK (delta <> 0),
  -- The register's "person name". Required on an issue (see below).
  taken_by    TEXT NULL
                CHECK (taken_by IS NULL OR
                       (length(trim(taken_by)) > 0 AND length(taken_by) <= 60)),
  note        TEXT NULL CHECK (note IS NULL OR length(note) <= 300),
  -- Who was at the screen. Not the same person as taken_by.
  entered_by  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The 10-minute undo is a SOFT void. A mistake must still leave a
  -- trace: the line stays in the register with a line through it, and
  -- stops counting towards stock.
  undone_at   TIMESTAMPTZ NULL,
  undone_by   UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- A "receive" that removes stock, or an "issue" that adds it, is a
  -- bug. The database refuses rather than trusting the caller.
  CONSTRAINT cnc_tool_movements_sign CHECK (
    (kind IN ('receive', 'return') AND delta > 0) OR
    (kind IN ('issue', 'scrap')    AND delta < 0) OR
    (kind = 'adjust')
  ),
  -- A tool leaving the crib must name the person who took it. This is
  -- the one rule the paper register already enforced and the one thing
  -- a digital version must not quietly lose.
  CONSTRAINT cnc_tool_movements_issue_needs_name CHECK (
    kind <> 'issue' OR (taken_by IS NOT NULL AND length(trim(taken_by)) > 0)
  ),
  -- Undone rows must carry both marks or neither.
  CONSTRAINT cnc_tool_movements_undo_pair CHECK (
    (undone_at IS NULL) = (undone_by IS NULL)
  ),
  -- The movement and the tool must belong to the SAME crib. Without
  -- this, a tampered form could post MOHIT's tool id under MANTHAN's
  -- vendor id and move stock in a crib the caller cannot even see.
  CONSTRAINT cnc_tool_movements_same_vendor
    FOREIGN KEY (tool_id, vendor_id)
    REFERENCES public.cnc_tools (id, vendor_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.cnc_tool_movements IS
  'Mig 227 — append-only tool register. Stock = SUM(delta) WHERE undone_at IS NULL. Rows are never edited or deleted; the 10-minute undo soft-voids.';
COMMENT ON COLUMN public.cnc_tool_movements.taken_by IS
  'Mig 227 — the person who physically took the tool. NOT entered_by: there is one login per vendor company, not one per operator.';

-- Stock sum + the tool history view, in one index.
CREATE INDEX IF NOT EXISTS cnc_tool_movements_tool_live_idx
  ON public.cnc_tool_movements (tool_id, created_at DESC)
  WHERE undone_at IS NULL;

-- The crib's whole register, newest first (includes undone rows — they
-- stay visible, struck through).
CREATE INDEX IF NOT EXISTS cnc_tool_movements_vendor_recent_idx
  ON public.cnc_tool_movements (vendor_id, created_at DESC);

-- Powers the self-filling "Taken by" picker: who has taken things from
-- this crib, most recent first.
CREATE INDEX IF NOT EXISTS cnc_tool_movements_taken_by_idx
  ON public.cnc_tool_movements (vendor_id, taken_by, created_at DESC)
  WHERE taken_by IS NOT NULL AND undone_at IS NULL;

-- ── 3. updated_at trigger ─────────────────────────────────────────
-- Its own function rather than reusing touch_updated_at_inventory(),
-- so the scaffolding module and this one share no objects at all.
CREATE OR REPLACE FUNCTION public.touch_updated_at_cnc_tools()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cnc_tools_touch_updated_at ON public.cnc_tools;
CREATE TRIGGER cnc_tools_touch_updated_at
  BEFORE UPDATE ON public.cnc_tools
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_cnc_tools();

-- ── 4. RLS ────────────────────────────────────────────────────────
-- House rule: RLS on, a single read policy for authenticated, and no
-- write policies at all — every write goes through a server action on
-- the service-role client, which is where the role gate lives.
ALTER TABLE public.cnc_tools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cnc_tools_read_all ON public.cnc_tools;
CREATE POLICY cnc_tools_read_all
  ON public.cnc_tools FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE public.cnc_tool_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cnc_tool_movements_read_all ON public.cnc_tool_movements;
CREATE POLICY cnc_tool_movements_read_all
  ON public.cnc_tool_movements FOR SELECT TO authenticated USING (TRUE);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verification (paste separately after running) ─────────────────
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_name in ('cnc_tools','cnc_tool_movements')
--  order by table_name, ordinal_position;
--
-- -- the cross-crib guard really holds (both of these must FAIL):
-- --   insert a movement whose vendor_id differs from its tool's vendor
-- --   insert kind='issue' with taken_by = NULL
--
-- select conname from pg_constraint
--  where conrelid = 'public.cnc_tool_movements'::regclass order by conname;
